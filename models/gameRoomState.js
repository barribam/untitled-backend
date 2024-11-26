// Define the game room states as a frozen object to make it immutable
const GameRoomState = Object.freeze({
    WAITING_FOR_HOST: {
        name: 'WAITING_FOR_HOST',
        label: 'Waiting for Host',
        description: 'Room is waiting for the host to start the game.'
    },
    CHOOSING_THEME: {
        name: 'CHOOSING_THEME',
        label: 'Choosing Theme',
        description: 'All players in the room enter their themes. This state occurs once per game.'
    },
    GENERATING_SECRET_WORDS: {
        name: 'GENERATING_SECRET_WORDS',
        label: 'Generating Secret Words',
        description: 'System generates secret words based on the entered theme or LLM-generated one.'
    },
    CHOOSING_WORD: {
        name: 'CHOOSING_WORD',
        label: 'Choosing Word',
        description: 'The Drawer chooses a word from the options provided by the system.'
    },
    DRAWING: {
        name: 'DRAWING',
        label: 'Drawing',
        description: 'The Drawer illustrates the word while Guessers try to guess it.'
    },
    ENDING: {
        name: 'ENDING',
        label: 'Ending',
        description: 'Game enters this state after the third round. System prepares to restart the game cycle (resets to Choosing Theme).'
    }
});

// Utility functions for working with game states
const GameRoomStateUtils = {
    getStateName(state) {
        return GameRoomState[state]?.name || state;
    },

    // Get state label
    getStateLabel(state) {
        return GameRoomState[state]?.label || state;
    },

    // Get state description
    getStateDescription(state) {
        return GameRoomState[state]?.description || '';
    },

    // Check if a state is valid
    isValidState(state) {
        return Object.keys(GameRoomState).includes(state);
    },

    // Get all available states
    getAllStates() {
        return Object.keys(GameRoomState);
    },

    // Get next state (useful for state transitions)
    getNextState(currentState) {
        const states = Object.keys(GameRoomState);
        const currentIndex = states.indexOf(currentState);
        return currentIndex === -1 ? null : states[(currentIndex + 1) % states.length];
    }
};

// Example usage:
// const currentState = GameRoomState.WAITING_FOR_HOST.name;
// console.log(GameRoomStateUtils.getStateLabel(currentState)); // "Waiting for Host"
// console.log(GameRoomStateUtils.getNextState(currentState)); // "CHOOSING_THEME"

module.exports = { 
    GameRoomState, 
    GameRoomStateUtils 
};