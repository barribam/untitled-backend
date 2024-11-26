const axios = require('axios')
const redis = require('../config/redis');
const { GameRoomState, GameRoomStateUtils } = require('./gameRoomState');
const connectionStateManager = require('../utils/ConnectionStateManager');

const MAX_PLAYERS = 5
const MAX_RETRIES = 3
const roundTimers = new Map()
const DRAWING_TIME = 80;

const BANNED_PLAYERS_PREFIX = 'bannedPlayers:';

// LLM
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GENERATE_WORD_MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const ORIGINAL_FALLBACK_WORDS = [
  // Animals
  'dog', 'cat', 'elephant', 'giraffe', 'lion', 'penguin', 'monkey', 'zebra', 'tiger',
  // Food
  'pizza', 'hamburger', 'spaghetti', 'sushi', 'taco', 'sandwich', 'hotdog', 'cookie', 'icecream',
  // Objects
  'chair', 'table', 'phone', 'computer', 'book', 'pencil', 'glasses', 'clock', 'lamp',
  // Nature
  'tree', 'flower', 'sun', 'cloud', 'mountain', 'river', 'beach', 'forest', 'rainbow',
  // Actions
  'running', 'sleeping', 'dancing', 'jumping', 'swimming', 'reading', 'singing', 'eating', 'writing',
  // Sports & Games
  'football', 'basketball', 'tennis', 'soccer', 'baseball', 'volleyball', 'chess', 'bowling', 'golf'
];
let currentFallbackWords = [...ORIGINAL_FALLBACK_WORDS];

/**
 * @typedef {Object} GameRoom
 * @property {string} gameState
 * @property {number} roundNumber
 * @property {string|null} currentSecretWord
 * @property {string} themes
 * @property {string} wordsList
 * @property {string} lastActive
 * @property {number} playersCount
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Player
 * @property {string} id // probably not going to be used, as username is already a unique identifier
 * @property {string} username
 * @property {string} role // "drawer" "guesser" "spectator"
 * @property {string} isHost // 1 is true 0 is false (best way to save booleans in Redis)
 * @property {number} score
 * @property {string} joinedAt
 * @property {Promise<Player>}
 */


// Client passes in player data inside room when first creating
const createRoom = async (room) => {
  const roomKey = `gameRoom:${room.accessCode}`;
  await redis.hmset(roomKey, {
    accessCode: room.accessCode,
    roundNumber: 1,
    currentSecretWord: "",
    themes: JSON.stringify(room.themes),
    wordsList: JSON.stringify(room.wordsList),
    players: JSON.stringify(room.players),
    gameState: GameRoomState.WAITING_FOR_HOST.name,
    playerCount: 0,
    createdAt: room.createdAt.toISOString(),
  });
  console.log('Room created', room.accessCode)
  return room;
};

const getRoom = async (accessCode) => {
  const roomKey = `gameRoom:${accessCode}`;
  const roomData = await redis.hgetall(roomKey);

  if (Object.keys(roomData).length === 0) {
    return null; // Room not found
  }

  return {
    accessCode: roomData.accessCode,
    roundNumber: parseInt(roomData.roundNumber || "0"),
    currentSecretWord: roomData.currentSecretWord,
    themes: JSON.parse(roomData.themes),
    wordsList: JSON.parse(roomData.wordsList),
    players: JSON.parse(roomData.players),
    gameState: roomData.gameState,
    playerCount: roomData.playerCount,
    createdAt: new Date(roomData.createdAt),
  };
};

const updateRoom = async (accessCode, room, options = { updatePlayerCount: false, isJoining: true }) => {
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
    try {
      const roomKey = `gameRoom:${accessCode}`;
      
      // Watch the key for changes
      await redis.watch(roomKey);
      
      // Check if room exists
      const roomExists = await redis.exists(roomKey);
      if (!roomExists) {
        await redis.unwatch();
        throw new Error('Game room not found');
      }

      // Check player limit
      if (room.players && room.players.length > MAX_PLAYERS) {
        await redis.unwatch();
        throw new Error('Room is full - maximum 5 players allowed');
      }

      // Get current room state
      const currentRoom = await getRoom(accessCode);
      const playerCountDiff = room.players.length - (currentRoom?.players?.length || 0);

      // Prepare room data
      const roomData = {
        accessCode: room.accessCode,
        roundNumber: room.roundNumber.toString(),
        currentSecretWord: room.currentSecretWord || "",
        themes: JSON.stringify(room.themes || []),
        wordsList: JSON.stringify(room.wordsList || []),
        players: JSON.stringify(room.players || []),
        gameState: room.gameState,
        lastActive: new Date().toISOString(),
      };

      if (room.createdAt) {
        roomData.createdAt = room.createdAt.toISOString();
      }

      // Start transaction
      const multi = redis.multi();
      
      // Add commands to transaction
      multi.hmset(roomKey, roomData);
      
      if (options.updatePlayerCount && playerCountDiff !== 0) {
        multi.hincrby(roomKey, 'playerCount', playerCountDiff);
      }

      // Execute transaction
      const result = await multi.exec();
      
      // If null, transaction failed due to concurrent modification
      if (!result) {
        console.log(`Concurrent modification detected for room ${accessCode}, attempt ${retries + 1}`);
        retries++;
        
        if (retries === MAX_RETRIES) {
          throw new Error('Maximum retry attempts reached');
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 100 * retries));
        continue;
      }

      // Transaction successful
      return await getRoom(accessCode);

    } catch (error) {
      // Unwatch in case of error
      await redis.unwatch();
      
      if (retries === MAX_RETRIES || 
          error.message === 'Game room not found' || 
          error.message === 'Room is full - maximum 5 players allowed') {
        console.error('Error updating game room: ', error);
        throw error;
      }
      
      retries++;
      console.log(`Retrying update for room ${accessCode}, attempt ${retries}`);
      await new Promise(resolve => setTimeout(resolve, 100 * retries));
    }
  }
  
  throw new Error('Failed to update game room after maximum retries');
}

const handlePlayerLeave = async (io, socket, accessCode, username) => {
  try {
    if (!connectionStateManager.isJoinComplete(socket.id)) {
      console.log(`Ignoring leave for ${username} - join was not completed`);
      return;
    }
    console.log(`Handling leave for player ${username} from room ${accessCode}`);
    
    // Get fresh room state for THIS specific room
    const currentRoom = await getRoom(accessCode);
    if (!currentRoom) {
      console.log(`Room ${accessCode} not found during leave`);
      return;
    }

    // IMPORTANT: Only process players from THIS room
    if (!currentRoom.players.some(p => p.username === username)) {
      console.log(`Player ${username} not found in room ${accessCode}, skipping leave`);
      return;
    }

    const leavingPlayer = currentRoom.players.find(p => p.username === username);
    const wasDrawer = leavingPlayer?.role === 'drawer';
    const wasHost = leavingPlayer?.isHost === "1";

    // Update ONLY this room's players
    const updatedPlayers = currentRoom.players.filter(p => p.username !== username);
    
    // If room is empty, delete it
    if (updatedPlayers.length === 0) {
      await deleteRoom(accessCode);
      io.to(accessCode).emit('room-deleted');
      return;
    }

    // If host left, assign new host to first remaining player
    if (wasHost && updatedPlayers.length > 0) {
      updatedPlayers[0].isHost = "1";
    }

    // First update the room with removed player
    const updatedRoom = await updateRoom(accessCode, {
      ...currentRoom,
      players: updatedPlayers
    }, { updatePlayerCount: true, isJoining: false });

    // Emit player left event
    io.to(accessCode).emit('player-left', {
      username,
      updatedRoom
    });

    // If host changed, notify room
    if (wasHost && updatedPlayers.length > 0) {
      io.to(accessCode).emit('host-changed', {
        newHost: updatedPlayers[0].username,
        updatedRoom
      });
    }

    // // If drawer left during an active game, trigger end drawing phase
    if (wasDrawer && currentRoom.gameState !== GameRoomState.WAITING_FOR_HOST.name) {
      io.to(accessCode).emit('clear-canvas');

      io.to(accessCode).emit('reset-word-selection');

      endDrawingPhase(io, accessCode)
    }

  } catch (error) {
    console.error('Error in handlePlayerLeave:', error);
  } finally {
    connectionStateManager.removeState(socket.id);
  }
};

// Helper function to validate and update host status
const validateHostUpdate = (players, leavingUsername) => {
  const currentHost = players.find(p => p.isHost === "1");
  if (!currentHost) {
    // No current host, assign first remaining player
    return {
      newHost: players[0]?.username,
      needsUpdate: true
    };
  }

  if (currentHost.username === leavingUsername) {
    // Host is leaving, assign new host
    const remainingPlayers = players.filter(p => p.username !== leavingUsername);
    return {
      newHost: remainingPlayers[0]?.username,
      needsUpdate: true
    };
  }

  return {
    newHost: null,
    needsUpdate: false
  };
};

const deleteRoom = async (accessCode) => {
  try {
      const roomKey = `gameRoom:${accessCode}`;
      await redis.del(roomKey);
      console.log(`Room deleted: ${accessCode}`);
      return true;
  } catch (error) {
      console.error('Error deleting room:', error);
      throw error;
  }
}

/**
 * Updates the host of a game room when the current host leaves
 * @param {string} accessCode - The room access code
 * @param {Array<Player>} players - Current players in the room
 * @param {string} leavingUsername - Username of the player who is leaving
 * @returns {Promise<{newHost: string|null, updatedPlayers: Array<Player>}>}
 */
const updateHostOnLeave = async (accessCode, players, leavingUsername) => {
  try {
    const roomKey = `gameRoom:${accessCode}`;
    
    // Get current room data from Redis to ensure we have the latest state
    const currentRoom = await getRoom(accessCode);
    if (!currentRoom) {
      console.log(`Room ${accessCode} not found`);
      return { newHost: null, updatedPlayers: [] };
    }

    // Create a copy of current players array
    let updatedPlayers = [...currentRoom.players];
    
    // Find and remove the leaving player
    const leavingPlayer = updatedPlayers.find(p => p.username === leavingUsername);
    if (!leavingPlayer) {
      console.log(`Player ${leavingUsername} not found in room ${accessCode}`);
      return { newHost: null, updatedPlayers };
    }

    // Remove the leaving player
    updatedPlayers = updatedPlayers.filter(p => p.username !== leavingUsername);

    // If no players left, delete the room
    if (updatedPlayers.length === 0) {
      await deleteRoom(accessCode);
      return { newHost: null, updatedPlayers: [] };
    }

    let newHost = null;
    // If the leaving player was the host, assign new host
    if (leavingPlayer.isHost === "1") {
      // Sort players by join time
      const sortedPlayers = updatedPlayers.sort((a, b) => 
        new Date(a.joinedAt) - new Date(b.joinedAt)
      );
      
      newHost = sortedPlayers[0];
      // Update host status
      updatedPlayers = updatedPlayers.map(player => ({
        ...player,
        isHost: player.username === newHost.username ? "1" : "0"
      }));
    }

    // Update room data in Redis with new player list
    const updatedRoom = {
      ...currentRoom,
      players: updatedPlayers,
      playerCount: updatedPlayers.length,
      // Reset game state if host changed
      gameState: newHost ? GameRoomState.WAITING_FOR_HOST.name : currentRoom.gameState
    };

    // Perform the Redis update
    await redis.hmset(roomKey, {
      ...updatedRoom,
      players: JSON.stringify(updatedPlayers),
      wordsList: JSON.stringify(updatedRoom.wordsList || []),
      lastActive: new Date().toISOString()
    });

    return {
      newHost: newHost?.username || null,
      updatedPlayers
    };
  } catch (error) {
    console.error('Error in updateHostOnLeave:', error);
    throw error;
  }
};

const getRandomIntegerInclusive = (min, max) => {
  min = Math.ceil(min)
  max = Math.floor(max)

  return Math.floor(Math.random() * (max - min + 1)) + min
}

const checkProfanity = async (text) => {
  try {
    const response = await axios.get(`https://api.api-ninjas.com/v1/profanityfilter?text=${encodeURIComponent(text)}`, {
      headers: { "X-Api-Key": process.env.PROFANITY_FILTER_API_KEY },
    });

    const { has_profanity } = response.data;
    console.log(response.data)
    return has_profanity;
  } catch (error) {
    console.error("Error checking profanity:", error.response?.data || error.message);
    return false;
  }
};


// Helper function to fetch words from an API based on the theme
// Load API_KEY from Gemini AI from .env


const generateWordsFromLLM = async (theme, retryCount = 0) => {

  const categories = ["people", "place", "animal"]
  const index = getRandomIntegerInclusive(0, 2)
  const randomCategory = categories[index]

  try {

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`,
      {
        contents: [
          {
            parts: [
              { text: `List 3 ${randomCategory}, 3 actions and 3 objects from ${theme}. 
              Limit words to 20 characters, all lowercase, and without special symbols.` }
            ]
          }
        ],
        generationConfig: {
          response_mime_type: "application/json",
          response_schema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                word: { type: "STRING" }
              }
            }
          }
        }
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Get the text from parts
    const rawText = response.data.candidates[0].content.parts[0].text
    
    // Parse the JSON string into an array of objects
    const wordsArray = JSON.parse(rawText);
    
    // Map to extract just the words
    const words = wordsArray.map(item => item.word);
  
    return words;

  } catch (error) {

    console.error("Error fetching words from Gemini AI:", error.response?.data || error.message);
    return getFallbackWords()
  }
}


const fetchWordsFromLLM = async (theme) => {
  try {
    // const isProfane = await checkProfanity(theme);
    // if (isProfane) {
    //   theme = "random theme";
    // }
    return await generateWordsFromLLM(theme)
  } catch (error) {
    console.error('Error fetching words from LLM:', error);
    throw error;
  }
} 

const resetFallbackWords = () => {
    currentFallbackWords = [...ORIGINAL_FALLBACK_WORDS];
    console.log('Fallback words reset, total words:', currentFallbackWords.length);
};

const getFallbackWords = () => {
    // If we're running low on words, reset the list
    if (currentFallbackWords.length < 3) {
        console.log('Fallback words running low, resetting...');
        resetFallbackWords();
    }

    const fallbackWords = [];
    for (let i = 0; i < 3; i++) {
        // Get random index
        const randomIndex = Math.floor(Math.random() * currentFallbackWords.length);
        // Remove and get the word at that index
        const word = currentFallbackWords.splice(randomIndex, 1)[0];
        fallbackWords.push(word);
    }

    console.log('Retrieved fallback words:', {
        words: fallbackWords,
        remainingWords: currentFallbackWords.length
    });

    return fallbackWords;
};

const startDrawingPhase = async (io, accessCode) => {
  let timeRemaining = DRAWING_TIME;
    io.to(accessCode).emit('clear-canvas');

  // Reset all players' hasGuessedCorrectly status
  const room = await getRoom(accessCode);
  if (room) {
    const updatedPlayers = room.players.map(p => ({
      ...p,
      hasGuessedCorrectly: false
    }));
    await updateRoom(accessCode, {
      ...room,
      players: updatedPlayers
    });
  }

  const timer = setInterval(async () => {
    if (timeRemaining <= 0) {
      clearInterval(timer);
      await endDrawingPhase(io, accessCode);
      return;
    }

    timeRemaining--;
    
    // Update the stored timeRemaining
    if (roundTimers.has(accessCode)) {
      roundTimers.get(accessCode).timeRemaining = timeRemaining;
    }

    io.to(accessCode).emit('timer-update', {
      timeRemaining,
      totalTime: DRAWING_TIME
    });
  }, 1000);

  // Store both interval and initial time remaining
  setRoundTimer(accessCode, timer);

  io.to(accessCode).emit('timer-update', {
    timeRemaining: DRAWING_TIME,
    totalTime: DRAWING_TIME
  });
}

const endDrawingPhase = async (io, accessCode) => {
  try {
    clearRoundTimer(accessCode);

    const room = await getRoom(accessCode);
    if (!room || !room.players) {
      console.log('No room found or invalid room state:', accessCode);
      return;
    }

    const currentDrawerIndex = room.players.findIndex(p => p.role === 'drawer');
    const nextDrawerIndex = (currentDrawerIndex + 1) % room.players.length;
    const isCompletingRound = nextDrawerIndex === 0;

    // Update players array with new roles
    const updatedPlayers = room.players.map((player, index) => ({
      ...player,
      role: index === nextDrawerIndex ? 'drawer' : 'guesser',
      hasBeenDrawer: index === currentDrawerIndex ? true : player.hasBeenDrawer,
      hasGuessedCorrectly: false,
      score: player.score,
    }));

    const allPlayersHaveBeenDrawer = updatedPlayers.every(player => player.hasBeenDrawer);

    const currentRound = parseInt(room.roundNumber)
    const newRoundNumber = (isCompletingRound && allPlayersHaveBeenDrawer && currentRound < 3) ?
    currentRound + 1 : currentRound;

    if (allPlayersHaveBeenDrawer) {
      updatedPlayers.forEach((player) => {
        player.hasBeenDrawer = false;
      });
    }

    // Check if game should end (when round 3 is complete)
    const shouldEndGame = isCompletingRound && currentRound === 3

    io.to(accessCode).emit('timer-update', {
      timeRemaining: 0,
      totalTime: DRAWING_TIME
    });

    if (shouldEndGame) {
      console.log('Game ending after round 3');

      // Reset scores and hasBeenDrawer for all players
      const resetPlayers = room.players.map(player => ({
        ...player,
        score: 0,
        hasBeenDrawer: false,
        hasGuessedCorrectly: false,
        role: player.role === 'drawer' ? 'guesser' : player.role // Reset drawer to guesser
      }));

      const finalRoom = await updateRoom(accessCode, {
        ...room,
        players: resetPlayers,
        gameState: GameRoomState.WAITING_FOR_HOST.name, // Reset to waiting for host
        currentSecretWord: '',
        roundNumber: 1, // Reset round number
        themes: [], // Clear themes
        wordsList: [], // Clear words list
      });

      const finalScores = room.players
        .map(p => ({
          username: p.username,
          score: p.score
        }))
        .sort((a, b) => b.score - a.score);

      // Check for tie
      const highestScore = finalScores[0].score;
      const playersWithHighestScore = finalScores.filter(p => p.score === highestScore);

      io.to(accessCode).emit('game-ended', {
        finalScores,
        result: playersWithHighestScore.length > 1
          ? { type: 'tie', players: playersWithHighestScore }
          : { type: 'winner', player: playersWithHighestScore[0] }
      });

      io.to(accessCode).emit('room-updated', finalRoom);

    } else {
      const updatedRoom = await updateRoom(accessCode, {
        ...room,
        players: updatedPlayers,
        currentSecretWord: '',
        wordsList: room.wordsList,
        gameState: GameRoomState.CHOOSING_WORD.name,
        roundNumber: newRoundNumber
      });

      io.to(accessCode).emit('room-updated', updatedRoom);
    }

  } catch (error) {
    console.error('Error in endDrawingPhase:', error);
  }
}

const handleGuess = async (io, socket, { accessCode, guess, username }) => {
  try {
    const room = await getRoom(accessCode);
    if (!room || room.gameState !== GameRoomState.DRAWING.name) {
      return;
    }

    const secretWord = room.currentSecretWord.toLowerCase();
    const userGuess = guess.toLowerCase().trim();

    // Get current drawer
    const drawer = room.players.find(p => p.role === 'drawer');
    if (!drawer) return;

    // Prevent drawer from guessing
    const isDrawer = room.players.some(p => 
      p.username === username && p.role === 'drawer'
    );
    if (isDrawer) {
      socket.emit('error', 'The drawer cannot guess the word');
      return;
    }

    // Check if player has already guessed correctly this round
    const playerHasGuessed = room.players.some(p => 
      p.username === username && p.hasGuessedCorrectly
    );
    if (playerHasGuessed) {
      socket.emit('error', 'You have already guessed the word correctly this round!');
      return;
    }

    // Check for exact match
    if (userGuess === secretWord) {
      // Get timer interval from the room state
      const timeRemaining = getRoundTimer(accessCode)

      let guesserScore = calculateGuesserScore(timeRemaining);
      const drawerScore = 10;

      console.log('Calculated score:', guesserScore); // Debug log

      const updatedPlayers = room.players.map(p => ({
        ...p,
        score: p.username === username ? 
               p.score + guesserScore : 
               p.username === drawer.username ? 
               p.score + drawerScore : 
               p.score,
        hasGuessedCorrectly: p.username === username ? true : p.hasGuessedCorrectly
      }));

      const updatedRoom = await updateRoom(accessCode, {
        ...room,
        players: updatedPlayers
      });

      io.to(accessCode).emit('correct-guess', { 
        guesser: username,
        guesserScore,
        drawerScore,
        word: secretWord,
        drawer: drawer.username
      });
      io.to(accessCode).emit('room-updated', updatedRoom);

      // Check if everyone has guessed correctly
      const allGuessed = updatedPlayers.every(p => 
        p.role === 'drawer' || p.hasGuessedCorrectly
      );

      // Only end round if everyone has guessed or time is up
      if (allGuessed) {
        endDrawingPhase(io, accessCode);
      }

      return;
    }


  } catch (error) {
    console.error('Error handling guess:', error);
    socket.emit('error', 'Failed to process guess');
  }
};

// Helper function to check if a guess is close
const checkCloseGuess = (secretWord, guess) => {
  // Both words should be more than 2 characters for close guess checking
  if (guess.length <= 2 || secretWord.length <= 2) return false;

  // Length similarity check (within 2 characters difference)
  const lengthDiff = Math.abs(secretWord.length - guess.length);
  if (lengthDiff <= 2) {
    // Count matching characters
    let matchingChars = 0;
    const minLength = Math.min(secretWord.length, guess.length);
    
    for (let i = 0; i < minLength; i++) {
      if (secretWord[i] === guess[i]) {
        matchingChars++;
      }
    }

    // If more than 60% of characters match
    if (matchingChars / minLength >= 0.6) {
      return true;
    }
  }

  // Check if one word contains the other
  if (secretWord.includes(guess) || guess.includes(secretWord)) {
    return true;
  }

  // Check for common letters
  const secretLetters = new Set(secretWord.split(''));
  const guessLetters = new Set(guess.split(''));
  const commonLetters = [...secretLetters].filter(letter => guessLetters.has(letter));
  
  // If more than 70% of letters match
  return commonLetters.length >= secretWord.length * 0.7;
};

const setRoundTimer = (accessCode, timer) => {
  // Clear any existing timer for this room
  if (roundTimers.has(accessCode)) {
    clearInterval(roundTimers.get(accessCode).interval);
  }
  // Store both the interval and the current time remaining
  roundTimers.set(accessCode, {
    interval: timer,
    timeRemaining: DRAWING_TIME
  });
};

const getRoundTimer = (accessCode) => {
  const timerData = roundTimers.get(accessCode);
  return timerData ? timerData.timeRemaining : 0;
};

const clearRoundTimer = (accessCode) => {
  if (roundTimers.has(accessCode)) {
    clearInterval(roundTimers.get(accessCode).interval);
    roundTimers.delete(accessCode);
  }
};

// Helper function to calculate guesser's score based on remaining time
const calculateGuesserScore = (timeRemaining) => {
  if (timeRemaining >= 61) return 100;
  if (timeRemaining < 61 && timeRemaining >= 31) return 75;
  if (timeRemaining < 31 && timeRemaining >= 11) return 50;
  return 25;
};

const isPlayerKicked = async (accessCode, username) => {
  try {
    const bannedKey = `${BANNED_PLAYERS_PREFIX}${accessCode}`;
    const isBanned = await redis.sismember(bannedKey, username.toLowerCase());
    return isBanned;
  } catch (error) {
    console.error('Error checking banned status:', error);
    return false;
  }
};

const kickPlayer = async (io, accessCode, kickedUsername, kicker) => {
  try {
    const room = await getRoom(accessCode);
    if (!room) {
      throw new Error('Room not found');
    }

    // Find kicked player's socket
    const kickedSocket = [...io.sockets.sockets.values()]
      .find(socket => {
        const state = connectionStateManager.getState(socket.id);
        return state?.username === kickedUsername && state?.accessCode === accessCode;
      });

    // Update room data first
    const updatedPlayers = room.players.filter(p => p.username !== kickedUsername);
    const wasDrawer = room.players.find(p => p.username === kickedUsername)?.role === 'drawer';

    const updatedRoom = await updateRoom(accessCode, {
      ...room,
      players: updatedPlayers.map(player => ({
        ...player,
        isHost: player.username === kicker ? "1" : player.isHost
      }))
    }, { updatePlayerCount: true, isJoining: false });

    // Ban the player
    const bannedKey = `${BANNED_PLAYERS_PREFIX}${accessCode}`;
    await redis.sadd(bannedKey, kickedUsername.toLowerCase());
    await redis.expire(bannedKey, 24 * 60 * 60);

    // Only notify the kicked player
    if (kickedSocket) {
      // Send kicked event ONLY to the kicked player
      kickedSocket.emit('kicked', 'You have been kicked from the room');
      // Clean up their connection
      connectionStateManager.removeState(kickedSocket.id);
      kickedSocket.leave(accessCode);
    }

    io.to(accessCode).emit('room-updated', updatedRoom)

    // Notify everyone else in the room EXCEPT the kicked player
    // Use io.to() to emit to the room, but exclude the kicked socket
    const socketsInRoom = await io.in(accessCode).allSockets();
    socketsInRoom.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      const state = connectionStateManager.getState(socketId);
      
      // Only send to players who aren't the kicked player
      if (state?.username !== kickedUsername) {
        socket.emit('player-kicked', {
          kickedPlayer: kickedUsername,
          updatedRoom
        });
      }
    });

    // Handle drawer kick during game
    if (wasDrawer && room.gameState !== GameRoomState.WAITING_FOR_HOST.name) {
      io.to(accessCode).emit('clear-canvas');
      setTimeout(() => {
        endDrawingPhase(io, accessCode);
      }, 0);
    }

    console.log('Kick operation completed:', {
      accessCode,
      kickedPlayer: kickedUsername,
      remainingPlayers: updatedPlayers.length,
      hostUsername: kicker
    });

    return updatedRoom;
  } catch (error) {
    console.error('Error kicking player:', error);
    throw error;
  }
};


module.exports = {
  createRoom,
  getRoom,
  updateRoom,
  deleteRoom,
  clearRoundTimer,
  fetchWordsFromLLM,
  startDrawingPhase,
  endDrawingPhase,
  updateHostOnLeave,
  handlePlayerLeave,
  resetFallbackWords,
  isPlayerKicked,
  kickPlayer,
  handleGuess,
  checkCloseGuess,
};
