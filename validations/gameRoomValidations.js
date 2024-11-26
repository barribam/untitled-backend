// validation/gameRoomValidation.js
const validateGameRoom = (room) => {
    const requiredFields = [
        'accessCode',
        'gameState',
        'players',
        'roundNumber'
    ];

    for (const field of requiredFields) {
        if (room[field] === undefined) {
            throw new Error(`Missing required field: ${field}`);
        }
    }

    // Validate gameState
    if (!Object.values(GameRoomState).some(state => state.name === room.gameState)) {
        throw new Error('Invalid game state');
    }

    // Validate players array
    if (!Array.isArray(room.players)) {
        throw new Error('Players must be an array');
    }

    // Validate player data
    room.players.forEach(player => {
        if (!player.username || !player.role) {
            throw new Error('Invalid player data');
        }
        if (!['drawer', 'guesser', 'spectator'].includes(player.role)) {
            throw new Error('Invalid player role');
        }
    });

    return true;
};

module.exports = {
    validateGameRoom
};