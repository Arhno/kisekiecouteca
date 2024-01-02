import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';

const app = express();
const server = createServer(app);
const io = new Server(server);

const __dirname = dirname(fileURLToPath(import.meta.url));

var rooms = {};
var guestid = 0;

function getUserName(name) {
  var user = name;
  if (user == "") {
    user = "guest_" + guestid;
    guestid++;
  }
  return user;
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); // The maximum is exclusive and the minimum is inclusive
}

function generateRoomName() {
  const characteres = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  var roomName = "";
  do {
    for(var i = 0 ; i<4 ; i++) {
      const idx = getRandomInt(0, characteres.length);
      roomName += characteres[idx];
    }
  } while (roomName in rooms);
  return roomName;
}

function addPlayer(roomName, user) {
  rooms[roomName].allPlayers.push({name: user, score: 0});
  rooms[roomName].playerGuess[user] = null;
  io.to(roomName).emit('new player list', {players: rooms[roomName].allPlayers});
}

function removePlayer(roomName, user) {
  console.log("remove player " + user + " from room " + roomName);
  if (!(roomName in rooms)) {
    console.log("no room to leave");
    return;
  }
  if (!(user in rooms[roomName].playerGuess)) {
    console.log("user not in room");
    return;
  }

  var removeId = -1;
  for (var i=0 ; i<rooms[roomName].allPlayers.length ; ++i) {
    if (rooms[roomName].allPlayers["name"] == user) {
      removeId = i;
      break;
    }
  }
  rooms[roomName].allPlayers.splice(removeId, 1);
  delete rooms[roomName].playerGuess[user];
  if (rooms[roomName].allPlayers.length == 0) {
    console.log("no more player in room " + roomName + " deleting");
    delete rooms[roomName];
  } else {
    console.log("new playerlist " + rooms[roomName].allPlayers)
    io.to(roomName).emit('new player list', {players: rooms[roomName].allPlayers});
  }
}

function sendNewTrack(roomName) {
  const randTrackIndex = getRandomInt(0, rooms[roomName].playlistTracks.length);
  const randTrackUri = rooms[roomName].playlistTracks[randTrackIndex].track.uri;
  rooms[roomName].currentId = rooms[roomName].playlistTracks[randTrackIndex].added_by.id;
  rooms[roomName].currentRound++;
  console.log("random track uri " + randTrackUri);
  console.log("user: " + rooms[roomName].allUsers[rooms[roomName].currentId])
  io.to(roomName).emit('new trak', {uri: randTrackUri});
}

function finishRound(roomName) {
  if (!(roomName in rooms)) {
    console.log("room no longer exists");
    return;
  }
  rooms[roomName].allPlayers.forEach((player) => {
    if (rooms[roomName].playerGuess[player.name] == rooms[roomName].currentId) {
      player.score += 1;
    }
    rooms[roomName].playerGuess[player.name] = null;
  });
  io.to(roomName).emit('new player list', {players: rooms[roomName].allPlayers});
  io.to(roomName).emit('answer', {id: rooms[roomName].currentId});
  
  if (rooms[roomName].currentRound < rooms[roomName].nbRound) {
    setTimeout(() => {
      sendNewTrack(roomName);
      setTimeout(() => {
        finishRound(roomName);
      }, 30000);
    }, 3000);
  }
}

async function processPlaylist(playlistId, socket) {
  const roomName = socket.roomName;
  rooms[roomName] = {
    playlistTracks: [],
    allUsers: {},
    allPlayers: [],
    playerGuess: {},
    nbRound: 50,
    currentRound: 0
  };

  var response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    body: "grant_type=client_credentials&client_id=6fb877c91e3948e987eefe93abee76f7&client_secret=8ea054743adb4306a0354178ab6e5d99",
    headers: {
      "Content-type": "application/x-www-form-urlencoded"
    }
  });
  const data = await response.json();
  const token = data.access_token
  console.log("api token: " + token);
  
  var offset = 0;
  var playlistData = null;
  do {
    response = await fetch("https://api.spotify.com/v1/playlists/" + playlistId + "/tracks?offset=" + offset, {
      method: "GET",
      headers: {
        Authorization: 'Bearer ' + token
      }
    });
    
    playlistData = await response.json();
    if ("error" in playlistData) {
      delete rooms[roomName];
      return;
    }
    rooms[roomName].playlistTracks = rooms[roomName].playlistTracks.concat(playlistData.items);
    offset += playlistData.items.length;
    console.log("fetched " + playlistData.items.length + " items");
  } while (playlistData.items.length > 0)
  
  for(var i=0 ; i<rooms[roomName].playlistTracks.length ; i++) {
    const element = rooms[roomName].playlistTracks[i];
    const userId = element.added_by.id;
    if (!(userId in rooms[roomName].allUsers)) {
      const userEndpoint = element.added_by.href;
      response = await fetch(userEndpoint, {
        method: "GET",
        headers: {
          Authorization: 'Bearer ' + token
        }
      });
      
      const userData = await response.json();
      const userName = userData.display_name;
      rooms[roomName].allUsers[userId] = userName;
    }
  }

  socket.emit("room init", {allUsers: rooms[roomName].allUsers, roomName: roomName, owner: true});
  addPlayer(socket.roomName, socket.playerName);
}

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('a user connected');
  socket.on('disconnect', () => {
    console.log('user disconnected');
    removePlayer(socket.roomName, socket.playerName);
  });

  socket.on('new room', (data) => {
    console.log('creating new room with playlist ' + data.playlist);
    socket.roomName = generateRoomName();
    socket.playerName = getUserName(data.user);
    console.log('new room name is ' + socket.roomName);
    socket.join(socket.roomName)
    processPlaylist(data.playlist, socket);
  });

  socket.on('join room', (data) => {
    console.log('join room ' + data.roomName);
    if (! (data.roomName in rooms)) {
      console.log("no room of that name");
      return;
    }
    socket.join(data.roomName)
    socket.roomName = data.roomName;
    socket.playerName = getUserName(data.user);
    socket.emit("room init", {allUsers: rooms[data.roomName].allUsers, roomName: data.roomName, owner: false});
    addPlayer(socket.roomName, socket.playerName);
  });

  socket.on('start', (data) => {
    console.log('start the game');
    sendNewTrack(socket.roomName);
    setTimeout(() => {
      finishRound(socket.roomName);
    }, 30000);
  });

  socket.on('new guess', (data) => {
    console.log('new guess for ' + socket.playerName);
    rooms[socket.roomName].playerGuess[socket.playerName] = data.guessId;
  });
});

server.listen(3000, () => {
  console.log('server running at http://localhost:3000');
});