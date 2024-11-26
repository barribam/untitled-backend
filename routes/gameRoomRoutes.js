const express = require('express')
const gameRoomController = require('../controllers/gameRoomController')
const authMiddleware = require('../middleware/authMiddleware')

const router = express.Router()

router.post('/game-room', gameRoomController.createGameRoom);
router.get('/game-room/:roomCode', gameRoomController.getGameRoom)
  
// // Endpoint to generate-words
// router.post('/generate-words', gameRoomController.generateWords)

// Rest is probably unnecessary I think
// Endpoint to add a player to a room
// router.post('/game-room/:accessCode/player', gameRoomController.addPlayerToGameRoom);

// // Endpoint to update game state
// router.post('/game-room/:accessCode/state', gameRoomController.updateGameState);


module.exports = router
