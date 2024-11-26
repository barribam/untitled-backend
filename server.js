const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const socketIo = require('socket.io')
const http = require('http');
const dotenv = require('dotenv')

const authRoutes = require('./routes/authRoutes')
const gameRoomRoutes = require('./routes/gameRoomRoutes');
const { handleSocketConnection: handleSocketConnection } = require('./controllers/gameRoomController');

dotenv.config()
const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: `*`, // Allow all origins (for development or testing)
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});
const port = process.env.PORT || 8080

app.use(cors())

app.use(bodyParser.json())

app.set('socketio', io);
app.use('/api/auth', authRoutes)
app.use('/api/game', gameRoomRoutes)

// io.on('connection', (socket) => handleSocketConnection(socket, io));
io.on('connection', (socket) => handleSocketConnection(socket, io))

server.listen(port, (err) => {
  if (err)
    console.log(err)
  console.log(`Server running in port ${port}`)
})
