class ConnectionStateManager {
    constructor() {
      if (ConnectionStateManager.instance) {
        return ConnectionStateManager.instance;
      }
      
      this.states = new Map();
      this.cleanupInterval = null;
      this.MAX_PLAYERS_PER_ROOM = 5;
      ConnectionStateManager.instance = this;
    }
  
    /**
     * Sets initial state for a socket connection
     */
    setState(socketId, state) {
      console.log(`Setting state for socket ${socketId}:`, state);
      this.states.set(socketId, {
        ...state,
        updatedAt: Date.now()
      });
    }
  
    /**
     * Gets state for a socket connection
     */
    getState(socketId) {
      return this.states.get(socketId);
    }
  
    /**
     * Removes state for a socket connection
     */
    removeState(socketId) {
      console.log(`Removing state for socket ${socketId}`);
      this.states.delete(socketId);
    }
  
    /**
     * Marks a join as complete for a socket
     */
    markJoinComplete(socketId, accessCode, username) {
      console.log(`Marking join complete for socket ${socketId} in room ${accessCode}`);
      const existingState = this.states.get(socketId);
      
      this.states.set(socketId, {
        ...existingState,
        status: 'joined',
        joinComplete: true,
        accessCode,
        username,
        updatedAt: Date.now()
      });
  
      const updatedState = this.states.get(socketId);
      console.log('Updated state after marking join complete:', updatedState);
    }
  
    /**
     * Checks if a join is complete for a socket
     */
    isJoinComplete(socketId) {
      const state = this.states.get(socketId);
      return state?.joinComplete || false;
    }
  
    /**
     * Checks if a room can accept more players
     */
    canJoinRoom(roomCode) {
      const activeCount = this.getActivePlayersCount(roomCode);
      const joiningCount = this.getJoiningPlayersCount(roomCode);
      const totalExpected = activeCount + joiningCount;
      
      console.log(`Room ${roomCode} status:`, {
        activeCount,
        joiningCount,
        totalExpected,
        maxPlayers: this.MAX_PLAYERS_PER_ROOM,
        states: this.getRoomStates(roomCode)
      });
  
      return totalExpected <= this.MAX_PLAYERS_PER_ROOM;
    }
  
    /**
     * Gets count of active players in a room
     */
    getActivePlayersCount(roomCode) {
      let count = 0;
      for (const state of this.states.values()) {
        if (state.accessCode === roomCode && 
            state.joinComplete === true && 
            state.status === 'joined') {
          count++;
        }
      }
      console.log(`Active players in room ${roomCode}:`, count);
      return count;
    }
  
    /**
     * Gets count of players currently joining a room
     */
    getJoiningPlayersCount(roomCode) {
      let count = 0;
      for (const state of this.states.values()) {
        if (state.accessCode === roomCode && 
            state.joinComplete === false && 
            state.status === 'joining') {
          count++;
        }
      }
      console.log(`Joining players in room ${roomCode}:`, count);
      return count;
    }
  
    /**
     * Gets all states for a specific room
     */
    getRoomStates(roomCode) {
      return Array.from(this.states.entries())
        .filter(([_, state]) => state.accessCode === roomCode)
        .map(([socketId, state]) => ({
          socketId,
          username: state.username,
          status: state.status,
          joinComplete: state.joinComplete,
          updatedAt: state.updatedAt
        }));
    }
  
    /**
     * Starts cleanup interval for stale states
     */
    startCleanup(interval = 30000) {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
  
      this.cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [socketId, state] of this.states.entries()) {
          // Clean up stale joining states (older than 1 minute)
          if (state.status === 'joining' && 
              !state.joinComplete && 
              now - state.updatedAt > 60000) {
            console.log(`Cleaning up stale joining state for socket ${socketId}`);
            this.states.delete(socketId);
          }
        }
      }, interval);
    }
  
    /**
     * Stops the cleanup interval
     */
    stopCleanup() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
    }
  
    /**
     * Dumps current state for debugging
     */
    dumpState() {
      return {
        totalConnections: this.states.size,
        connectionStates: Array.from(this.states.entries()).map(([socketId, state]) => ({
          socketId,
          ...state
        }))
      };
    }
  }
  
  // Create and export singleton instance
  const connectionStateManager = new ConnectionStateManager();
  Object.freeze(connectionStateManager);
  
  module.exports = connectionStateManager;