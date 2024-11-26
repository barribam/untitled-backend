const GameRoomManager = require('../models/gameRoomManager')
const { GameRoomState } = require('../models/gameRoomState');
const connectionStateManager = require('../utils/ConnectionStateManager');
const { safeJSONParse } = require('../utils/Parsing');

const MAX_PLAYERS = 5

const handleSocketConnection = (socket, io) => {
  console.log('A socket connected:', socket.id);
  let playerInfo = null
  connectionStateManager.setState(socket.id, {
    status: 'connected',
    joinComplete: false,
  })

  // Handle player joining a room
  // WIP
  socket.once('join-room', async (accessCode, username) => {
    try {
      console.log(`Player ${username} attempting to join room: ${accessCode}`);

      // Check if player is kicked from this room
      const isKicked = await GameRoomManager.isPlayerKicked(accessCode, username);
      if (isKicked) {
        socket.emit('error', 'You have been kicked from this room');
        return;
      }
      
      const room = await GameRoomManager.getRoom(accessCode);
      if (!room) {
        socket.emit('error', 'Room not found');
        return;
      }

      if (room.gameState !== GameRoomState.WAITING_FOR_HOST.name) {
        socket.emit('error', 'Cannot join game in progress!')
        return;
      }

      connectionStateManager.setState(socket.id, { 
        status: 'joining', 
        joinComplete: false,
        accessCode,
        username 
      });

      const playerExists = room.players.some(p => p.username === username);
      const isFirstPlayer = room.players.length === 0;

      // If not an existing player, check room capacity
      if (!playerExists && !isFirstPlayer) {
        if (room.players.length >= MAX_PLAYERS) {
          socket.emit('error', 'Room is full');
          connectionStateManager.removeState(socket.id);
          return;
        }

        if (!connectionStateManager.canJoinRoom(accessCode)) {
          socket.emit('error', 'Room is full');
          connectionStateManager.removeState(socket.id);
          return;
        }
      }

      const updatedPlayers = playerExists ? room.players : [
        ...room.players,
        {
          username,
          role: "guesser",
          isHost: isFirstPlayer ? "1" : "0",
          score: 0,
          joinedAt: new Date().toISOString()
        }
      ];

      const updatedRoom = await GameRoomManager.updateRoom(accessCode, {
        ...room,
        players: updatedPlayers
      });

      await socket.join(accessCode);

      playerInfo = { 
        accessCode, 
        username, 
        isHost: isFirstPlayer ? "1" : "0"
      };

      connectionStateManager.markJoinComplete(socket.id, accessCode, username)

      // Log the current state after join
      console.log('Room state after join:', {
        roomCode: accessCode,
        playerCount: updatedPlayers.length,
        activePlayersCount: connectionStateManager.getActivePlayersCount(accessCode),
        joiningPlayersCount: connectionStateManager.getJoiningPlayersCount(accessCode)
      });

      socket.emit('room-joined', updatedRoom);

      if (!playerExists) {
        io.to(accessCode).emit('chat-message', {
          content: `${username} has joined the game!`,
          type: 'system'
        });
      }

      socket.to(accessCode).emit('room-updated', updatedRoom);

      console.log(`Player ${username} successfully joined room ${accessCode}`);

    } catch (error) {
      console.error('Error in join-room:', error);
      socket.emit('error', 'Failed to join room');
      connectionStateManager.removeState(socket.id);
    }
  });

  // Add kick handler
  socket.on('kick-player', async ({ accessCode, username }) => {
    try {
      const state = connectionStateManager.getState(socket.id);
      if (!state?.username) {
        socket.emit('error', 'Not authorized to kick players');
        return;
      }

      // Check if room exists
      const room = await GameRoomManager.getRoom(accessCode);
      if (!room) {
        socket.emit('error', 'Room not found');
        return;
      }

      // Verify kicker is host
      const isHost = room.players.some(p => 
        p.username === state.username && p.isHost === "1"
      );

      if (!isHost) {
        socket.emit('error', 'Only the host can kick players');
        return;
      }
  
      const playerExists = room.players.some(p => p.username === username);
      if (!playerExists) {
        socket.emit('error', 'Player not found in room');
        return;
      }

      console.log('Initiating kick:', {
        room: accessCode,
        kicker: state.username,
        playerToKick: username
      });

      const updatedRoom = await GameRoomManager.kickPlayer(io, accessCode, username, state.username);

      if (playerExists) {
        io.to(accessCode).emit('chat-message', {
          content: `${username} has been kicked!`,
          type: 'system'
        });
      }

      console.log('Kick completed:', {
        room: accessCode,
        remainingPlayers: updatedRoom.players.length,
        hostUsername: state.username
      });

    } catch (error) {
      console.error('Error in kick-player handler:', error);
      socket.emit('error', error.message);
    }
  });
  
  // Handle explicit leave room
  socket.on('leave-room', async ({ accessCode, username }) => {
    try {
      if (!accessCode || !username) {
        console.log('Invalid leave-room data:', { accessCode, username });
        return;
      }

      const state = connectionStateManager.getState(socket.id);
      if (state && state.accessCode && state.username) {
        // Only emit message and handle leave if the state exists and join was complete
        io.to(state.accessCode).emit('chat-message', {
          content: `${state.username} has left the game!`,
          type: 'system'
        });
      }

      if (connectionStateManager.isJoinComplete(socket.id)) {
        await GameRoomManager.handlePlayerLeave(io, socket, accessCode, username);
        socket.leave(accessCode);
        playerInfo = null;
      }
    } catch (error) {
      console.error('Error in leave-room:', error);
    } finally {
      connectionStateManager.removeState(socket.id);
    }
  });

  socket.on('disconnect', async () => {
    try {
      const state = connectionStateManager.getState(socket.id);
      if (state && state.accessCode && state.username) {
        // Only emit message and handle leave if the state exists and join was complete
        io.to(state.accessCode).emit('chat-message', {
          content: `${state.username} has left the game!`,
          type: 'system'
        });

        await GameRoomManager.handlePlayerLeave(io, socket, state.accessCode, state.username);
      }
    } catch (error) {
      console.error('Error in disconnect:', error);
    } finally {
      connectionStateManager.removeState(socket.id);
    }
  })

  socket.on('start-game', async ({ accessCode }) => {
    try {
      const room = await GameRoomManager.getRoom(accessCode)
      if (!room) return

      GameRoomManager.resetFallbackWords()

      room.gameState = GameRoomState.CHOOSING_THEME.name;
      await GameRoomManager.updateRoom(accessCode, room);
      io.to(accessCode).emit("room-updated", room);

    } catch (error) {
      console.error("Error starting game:", error);
      socket.emit("error", "Failed to start game");
    }
  })


  socket.on('submit-theme', async({ theme, accessCode, playerName }) => {
    try {
      console.log(`Player ${playerName} submitting theme in room ${accessCode}`);
      
      // Get current room state
      const currentRoom = await GameRoomManager.getRoom(accessCode);
      if (!currentRoom) {
        socket.emit('error', 'Room not found');
        return;
      }
  
      // Validate existing submission
      const existingThemes = Array.isArray(currentRoom.themes) ? currentRoom.themes : [];
      if (existingThemes.some(t => t.playerName === playerName)) {
        socket.emit('error', 'You have already submitted a theme');
        return;
      }
  
      // Generate words
      const words = await GameRoomManager.fetchWordsFromLLM(theme);
      if (!Array.isArray(words) || words.length === 0) {
        socket.emit('error', 'Failed to generate words for theme');
        return;
      }
  
      // Important: Get fresh room state before update to ensure we have latest data
      const freshRoom = await GameRoomManager.getRoom(accessCode);
      if (!freshRoom) {
        socket.emit('error', 'Room not found');
        return;
      }

      const willBeAllThemesSubmitted = freshRoom.themes.length + 1 === freshRoom.players.length;
  
      // Prepare updated room with merged data from fresh state
      const updatedRoom = {
        ...freshRoom,
        wordsList: [...(freshRoom.wordsList || []), ...words],
        themes: [...(freshRoom.themes || []), { theme, playerName }],
      };

      if (willBeAllThemesSubmitted) {
        console.log('All themes submitted, assigning first drawer');
        // Assign new player role once everyone had submitted
        updatedRoom.players = freshRoom.players.map((player, index) => ({
          ...player,
          role: index === 0 ? 'drawer' : 'guesser'
        }));
        updatedRoom.gameState = GameRoomState.CHOOSING_WORD.name
      }
  
      // Use updateRoom with retries for atomic update
      const result = await GameRoomManager.updateRoom(accessCode, updatedRoom);

      // Emit success
      io.to(accessCode).emit('room-updated', result);

      console.log('Room updated:', {
        themesCount: result.themes.length,
        playersCount: result.players.length,
        gameState: result.gameState,
        drawer: result.players.find(p => p.role === 'drawer')?.username
      });


    } catch (error) {
      console.error('Error in theme submission:', error);
      socket.emit('error', 'Failed to submit theme');
    }
  })


  socket.on('update-game-state', async ({ accessCode, newGameState }) => {
    try {
        const room = await GameRoomManager.getRoom(accessCode);
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        room.gameState = newGameState;
        const updatedRoom = await GameRoomManager.updateRoom(accessCode, room);
        
        io.to(accessCode).emit('room-updated', updatedRoom);
    } catch (error) {
        console.error('Error updating game state:', error);
        socket.emit('error', 'Failed to update game state');
    }
  });

  socket.on('select-word', async({ accessCode, selectedWord, wordChoices }) => {
    try {
      const room = await GameRoomManager.getRoom(accessCode)
      if (!room) {
        socket.emit('error',  'Room not found')
        return
      }

      // Verify the player is the drawer
      const playerInfo = await connectionStateManager.getState(socket.id)
      const isDrawer = room.players.some(p => 
        p.username === playerInfo?.username && p.role === 'drawer'
      )

      if (!isDrawer) {
        socket.emit('error', 'Only the drawer can select a word')
        return
      }

      // Remove all shown words from wordsList
      const updatedWordsList = room.wordsList.filter(
        word => !wordChoices.includes(word)
      )

      const updatedRoom = await GameRoomManager.updateRoom(accessCode, {
        ...room,
        currentSecretWord: selectedWord,
        wordsList: updatedWordsList,
        gameState: GameRoomState.DRAWING.name,
        roundStartTime: Date.now(),
      })

      io.to(accessCode).emit('room-updated', updatedRoom)

      GameRoomManager.startDrawingPhase(io, accessCode)

      console.log('Word selection completed:', {
        selectedWord,
        removedWords: wordChoices,
        remainingWords: updatedWordsList.length,
        gameState: updatedRoom.gameState,
        roundStartTime: Date.now(),
      });

    } catch (error) {
      console.error('Error in word selection: ', error)
      socket.emit('error', 'Failed to select word')
    }
  })

  // ? https://socket.io/docs/v4/broadcasting-events/
  socket.on('chat-message', (data) => {
    io.to(data.roomCode).emit("chat-message", data)
  });

  // Socket handler for when a word is guessed correctly
  socket.on('guess-word', async (data) => {
    try {
      await GameRoomManager.handleGuess(io, socket, {
        accessCode: data.accessCode,
        guess: data.guess,
        username: data.username
      });
    } catch (error) {
      console.error('Error handling guess:', error)
    }
  })
  
  socket.on('draw-line', (data) => {
    const { roomCode, start, end, color, brushSize } = data;

    // Broadcast drawing data to all other clients in the room
    socket.to(roomCode).emit('draw-line', {
      start,
      end,
      color,
      brushSize
    });
  });

  socket.on('canvas-history-update', (data) => {
    socket.to(data.roomCode).emit('canvas-history-update', {
      canvasData: data.canvasData,
      actionType: data.actionType,
      stateIndex: data.stateIndex
    });
  });

  socket.on('clear-canvas', ({ roomCode }) => {
    // Broadcast clear command to all other clients in the room
    socket.to(roomCode).emit('clear-canvas');
  });

  // Optional: handle initial canvas state for new joiners
  socket.on('request-canvas-state', ({ roomCode }) => {
    // Broadcast to other clients in the room to request current canvas state
    socket.to(roomCode).emit('get-canvas-state');
  })

  // Optional: Handle sending canvas state to new joiners
  socket.on('send-canvas-state', ({ roomCode, canvasData }) => {
    // Send the canvas data to all clients in the room who need it
    socket.to(roomCode).emit('receive-canvas-state', { canvasData });
  });
};

// Helper functions

// Verify if all players have been drawer
const haveAllPlayersBeenDrawer = (players) => {
  return players.every(player => player.hasBeenDrawer);
};


const isCloseGuess = (guess, word) => {
  return guess.length === word.length || 
         word.toLowerCase().includes(guess.toLowerCase()) ||
         guess.toLowerCase().includes(word.toLowerCase());
};
  
const createGameRoom = async (req, res) => {
  const io = req.app.get('socketio');
  const accessCode = generateAccessCode();
  const newRoom = {
    accessCode: accessCode,
    roundNumber: 0,
    currentSecretWord: "",
    wordsList: [],
    themes: [],
    players: [],
    gameState: "",
    createdAt: new Date(),
  };

  try {
    const room = await GameRoomManager.createRoom(newRoom);
    if (!room) {
      res.status(500).json({
        message: 'Internal Server Error when trying to create game room. Please try agian later.'
      })
    }

    // Respond with access code
    res.status(201).json({
      message: 'Game room created successfully',
      accessCode: newRoom.accessCode,
    });

    // Notify any relevant listeners via socket (optional)
    io.emit('room-created', { accessCode: newRoom.accessCode });
  } catch (error) {
    console.error('Error creating game room:', error);
    res.status(500).json({ error: 'Failed to create game room' });
  }
};

const getGameRoom = async (req, res) => {
  const io = req.app.get('socketio');
  const roomCode = req.params.roomCode

  try {
    const room = await GameRoomManager.getRoom(roomCode);
    if (!room) {
      res.status(500).json({
        message: 'Internal Server Error when trying to create game room. Please try agian later.',
        roomCode: room.accessCode
      })
      return
    } 

    res.status(200).json({
      accessCode: room.accessCode,
      createdAt: room.createdAt,
      players: room.players,
      gameState: room.gameState,
    })

  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve game room' });
  }
}

// TODO: access code should be the first 6 caracters of the uuid
const generateAccessCode = () => {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
};

module.exports = {
  handleSocketConnection,
  createGameRoom,
  getGameRoom,
}
