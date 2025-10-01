const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const MASTER_FOOD_LIST = [
    { name: 'Pani Puri', image: 'images/pani-puri.jpg', cuisine: 'Indian' },
    { name: 'Chole Bhature', image: 'images/chole-bhature.jpg', cuisine: 'Indian' },
    { name: 'Momos', image: 'images/momos.jpg', cuisine: 'Indian' },
    { name: 'Pav Bhaji', image: 'images/pav-bhaji.jpg', cuisine: 'Indian' },
    { name: 'Dal Rice', image: 'images/dal-rice.jpg', cuisine: 'Indian' },
    { name: 'Samosa', image: 'images/samosa.jpg', cuisine: 'Indian' },
    { name: 'Aloo Paratha', image: 'images/aloo-paratha.jpg', cuisine: 'Indian' },
    { name: 'Biryani', image: 'images/biryani.jpg', cuisine: 'Indian' },
    { name: 'Butter Paneer and Naan', image: 'images/butter-paneer.jpg', cuisine: 'Indian' },
    { name: 'Tacos', image: 'images/tacos.jpg', cuisine: 'Mexican' },
    { name: 'Burrito', image: 'images/burrito.jpg', cuisine: 'Mexican' },
    { name: 'Nachos', image: 'images/nachos.jpg', cuisine: 'Mexican' },
    { name: 'Quesadilla', image: 'images/quesadilla.jpg', cuisine: 'Mexican' },
    { name: 'Manchurian', image: 'images/manchurian.jpg', cuisine: 'Chinese' },
    { name: 'Paneer Chilly', image: 'images/paneer-chilly.jpg', cuisine: 'Chinese' },
    { name: 'Fried Rice', image: 'images/fried-rice.jpg', cuisine: 'Chinese' },
    { name: 'Spring Rolls', image: 'images/spring-rolls.jpg', cuisine: 'Chinese' },
    { name: 'Noodles', image: 'images/noodles.jpg', cuisine: 'Chinese' },
    { name: 'Ramen', image: 'images/ramen.jpg', cuisine: 'Chinese' },
    { name: 'Pizza', image: 'images/pizza.jpg', cuisine: 'Italian' },
    { name: 'Pasta', image: 'images/pasta.jpg', cuisine: 'Italian' },
    { name: 'Spaghetti', image: 'images/spaghetti.jpg', cuisine: 'Italian' },
    { name: 'Pizza Dosa', image: 'images/pizza-dosa.jpg', cuisine: 'South Indian' },
    { name: 'Masala Dosa', image: 'images/masala-dosa.jpg', cuisine: 'South Indian' },
    { name: 'Idli Sambhar', image: 'images/idli-sambhar.jpg', cuisine: 'South Indian' },
    { name: 'Thatte Idli', image: 'images/thatte-idli.jpg', cuisine: 'South Indian' },
    { name: 'Medu Wada', image: 'images/medu-wada.jpg', cuisine: 'South Indian' },
    { name: 'Utpam', image: 'images/utpam.jpg', cuisine: 'South Indian' },
    { name: 'Cold Coffee', image: 'images/cold-coffee.jpg', cuisine: 'Beverages' },
    { name: 'Cold Drink', image: 'images/cold-drink.jpg', cuisine: 'Beverages' },
    { name: 'Energy Drink', image: 'images/energy-drink.jpg', cuisine: 'Beverages' },
    { name: 'Juice', image: 'images/juice.jpg', cuisine: 'Beverages' },
    { name: 'Lassi', image: 'images/lassi.jpg', cuisine: 'Beverages' },
    { name: 'Chaas', image: 'images/chaas.jpg', cuisine: 'Beverages' },
    { name: 'Coffee', image: 'images/coffee.jpg', cuisine: 'Beverages' },
    { name: 'Soup', image: 'images/soup.jpg', cuisine: 'Beverages' },
    { name: 'Burger', image: 'images/burger.jpg', cuisine: 'American' },
    { name: 'Sandwich', image: 'images/sandwich.jpg', cuisine: 'American' },
    { name: 'Hot Dog', image: 'images/hot-dog.jpg', cuisine: 'American' },
    { name: 'Pancakes', image: 'images/pancakes.jpg', cuisine: 'American' },
    { name: 'Hot Dog', image: 'images/hot-dog.jpg', cuisine: 'American' },
    { name: 'French Fries', image: 'images/french-fries.jpg', cuisine: 'American' },
    { name: 'Gulab Jamun', image: 'images/gulab-jamun.jpg', cuisine: 'Desserts' },
    { name: 'Ice Cream', image: 'images/ice-cream.jpg', cuisine: 'Desserts' },
    { name: 'Waffle', image: 'images/waffle.jpg', cuisine: 'Desserts' },
    { name: 'Pie', image: 'images/pie.jpg', cuisine: 'Desserts' },
    { name: 'Tiramisu', image: 'images/tiramisu.jpg', cuisine: 'Desserts' },
    { name: 'Pastry', image: 'images/pastry.jpg', cuisine: 'Desserts' },
    { name: 'Chocolate Mousse', image: 'images/chocolate-mousse.jpg', cuisine: 'Desserts' }
];

let rooms = {};

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
};

const compileAndSendResults = (roomId) => {
    const room = rooms[roomId];
    if (!room || room.gameState === 'results') return;

    room.gameState = 'results';
    const compiledScores = {};
    for (const playerRatings of Object.values(room.ratings)) {
        for (const foodRating of playerRatings) {
            if (!compiledScores[foodRating.name]) {
                compiledScores[foodRating.name] = { totalScore: 0, count: 0, image: foodRating.image, cuisine: foodRating.cuisine };
            }
            compiledScores[foodRating.name].totalScore += foodRating.rating;
            compiledScores[foodRating.name].count++;
        }
    }
    const results = Object.entries(compiledScores).map(([name, data]) => ({ name, avgScore: data.totalScore / data.count, image: data.image, cuisine: data.cuisine }));
    results.sort((a, b) => b.avgScore - a.avgScore);
    
    room.finalResults = results.slice(0, 5);
    io.to(roomId).emit('resultsCompiled', { topFoods: room.finalResults });
};

const startBlendForRoom = (roomId, cuisineSet) => {
    const room = rooms[roomId];
    if (!room) return;
    room.gameState = 'rating';
    
    const foodList = MASTER_FOOD_LIST.filter(food => cuisineSet.has(food.cuisine));
    if (foodList.length === 0) {
        for (let i = 0; i < 4; i++) foodList.push(MASTER_FOOD_LIST[Math.floor(Math.random() * MASTER_FOOD_LIST.length)]);
    }
    
    const uniqueFoodList = [...new Set(foodList)];
    shuffleArray(uniqueFoodList); // Randomize the list
    
    io.to(roomId).emit('startBlend', { foodList: uniqueFoodList });
};

io.on('connection', (socket) => {
    socket.on('createRoom', ({ name }) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            players: [{ id: socket.id, name, isHost: true, disconnected: false }],
            gameState: 'waiting',
            cuisines: {},
            ratings: {},
            finalResults: []
        };
        socket.join(roomId);
        socket.roomId = roomId; // Store roomId for efficient disconnect
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players, name, masterFoodList: MASTER_FOOD_LIST });
    });

    socket.on('joinRoom', ({ name, roomId }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('error', { message: 'Room not found.' });
        
        const existingPlayer = room.players.find(p => p.name === name && p.disconnected);
        if (existingPlayer) {
            existingPlayer.disconnected = false;
            existingPlayer.id = socket.id;
            socket.join(roomId);
            socket.roomId = roomId; // Store roomId for efficient disconnect
            io.to(roomId).emit('playerReconnected', { players: room.players });
            socket.emit('rejoinSuccess', { roomId, players: room.players, name, gameState: room.gameState, foodCart: room.foodList, masterFoodList: MASTER_FOOD_LIST, finalResults: room.finalResults });
            return;
        }

        if (room.players.length >= 8) return socket.emit('error', { message: 'Room is full.' });
        
        room.players.push({ id: socket.id, name, isHost: false, disconnected: false });
        socket.join(roomId);
        socket.roomId = roomId; // Store roomId for efficient disconnect
        socket.emit('roomJoined', { roomId, players: room.players, name, masterFoodList: MASTER_FOOD_LIST });
        socket.to(roomId).emit('playerJoined', { players: room.players });
    });

    socket.on('startCuisineSelection', ({ roomId }) => {
        const room = rooms[roomId];
        const host = room?.players.find(p => p.isHost);
        if (room && host && host.id === socket.id) {
            room.gameState = 'cuisines';
            io.to(roomId).emit('navigateToCuisines');
        }
    });

    socket.on('submitCuisines', ({ roomId, cuisines }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id && !p.disconnected);
        if(!player) return;
        room.cuisines[socket.id] = cuisines;
        const host = room.players.find(p => p.isHost && !p.disconnected);
        if (host  && cuisines.length >= 5) {
            io.to(host.id).emit('forceBlendReady');
        }
        const activePlayers = room.players.filter(p => !p.disconnected);
        const allActivePlayersSubmitted = activePlayers.every(p => room.cuisines[p.id]);
        if (allActivePlayersSubmitted && activePlayers.length > 0) {
            const allCuisines = new Set([].concat(...Object.values(room.cuisines)));
            startBlendForRoom(roomId, allCuisines);
        }
    });

    socket.on('updateGlobalList', ({ roomId, foodName, foodCuisine, isChecked }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!room.foodCart) {
        room.foodCart = [];
    }

    if (isChecked) {
        if (!room.foodCart.some(item => item.name === foodName)) {
            room.foodCart.push({ name: foodName, cuisine: foodCuisine });
        }
    } else {
        room.foodCart = room.foodCart.filter(item => item.name !== foodName);
    }

    io.to(roomId).emit('globalListUpdated', room.foodCart);
    });
    
    socket.on('forceSubmitCuisines', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        const allSubmittedCuisines = new Set([].concat(...Object.values(room.cuisines)));
        
        if (allSubmittedCuisines.size > 0) {
            startBlendForRoom(roomId, allSubmittedCuisines);
        }
    });

    socket.on('submitRatings', ({ roomId, ratings }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id && !p.disconnected);
        if(!player) return;
        room.ratings[socket.id] = ratings;
        const activePlayers = room.players.filter(p => !p.disconnected);
        const allActivePlayersRated = activePlayers.every(p => room.ratings[p.id]);

        if (allActivePlayersRated && activePlayers.length > 0) {
            io.to(roomId).emit('navigateToCompiling');
            setTimeout(() => {
                compileAndSendResults(roomId);
            }, 100);
        }
    });
    
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.disconnected = true;
                const wasHost = player.isHost;
                if (wasHost) {
                    player.isHost = false;
                    const newHost = room.players.find(p => !p.disconnected);
                    if (newHost) newHost.isHost = true;
                }
                if (room.players.every(p => p.disconnected)) {
                    setTimeout(() => {
                        if (rooms[roomId] && rooms[roomId].players.every(p => p.disconnected)) {
                            delete rooms[roomId];
                        }
                    }, 60000); // Clean up empty rooms after 1 minute
                }
                io.to(roomId).emit('playerDisconnected', { players: room.players });
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});