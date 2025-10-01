document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    const screens = document.querySelectorAll('.screen');
    const nameInput = document.getElementById('your-name-input');
    const errorMessage = document.getElementById('error-message');
    const homeButtons = document.querySelectorAll('.home-button');
    const listNavButton = document.getElementById('list-nav-button');
    const listOverlay = document.getElementById('list-overlay');
    const closeListBtn = document.getElementById('close-list-btn');
    const finalLitsUl = document.getElementById('final-list-ul');
    const waitingOverlay = document.getElementById('waiting-overlay');
    
    let foodCart = [];
    let masterFoodList = [];
    let localPlayersList = [];
    let isHost = false;

    const showScreen = (screenId) => {
        screens.forEach(s => s.classList.remove('active'));
        const screenToShow = document.getElementById(screenId);
        if (screenToShow) screenToShow.classList.add('active');
    };

    const updatePlayerList = (players) => {
        localPlayersList = players;
        const me = localPlayersList.find(p => p.id === socket.id);
        if (me) {
            isHost = me.isHost; // Update the isHost flag
        }
        const playersList = document.getElementById('players-list');
        const playerCount = document.getElementById('player-count');
        const startBlendBtn = document.getElementById('start-blend-btn');
        if (!playersList) return;
        playersList.innerHTML = '';
        const activePlayers = players.filter(p => !p.disconnected);
        playerCount.textContent = activePlayers.length;
        players.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.name;
            if (p.disconnected) {
                li.style.opacity = '0.5';
                li.textContent += ' (disconnected)';
            }
            if (p.isHost) {
                const hostTag = document.createElement('span');
                hostTag.className = 'host-tag';
                hostTag.textContent = 'Host';
                li.appendChild(hostTag);
            }
            if (p.id === socket.id && p.isHost) {
                startBlendBtn.disabled = activePlayers.length < 2;
            }
            playersList.appendChild(li);
        });
    };
    
    const syncCheckboxesWithCart = () => {
        const checkboxes = document.querySelectorAll('#results-tbody input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            const foodName = checkbox.dataset.name;
            checkbox.checked = foodCart.some(item => item.name === foodName);
        });
    };
    
    const renderList = () => {
        if (!finalLitsUl) return;
        finalLitsUl.innerHTML = '';
        if (foodCart.length === 0) {
            finalLitsUl.innerHTML = '<li>Your list is empty. Add items from the results!</li>';
        } else {
            foodCart.forEach(item => {
                const li = document.createElement('li');
                li.textContent = `${item.name} (${item.cuisine})`;
                finalLitsUl.appendChild(li);
            });
        }
    };

    const toggleListOverlay = () => {
        if (!listOverlay) return;
        renderList();
        listOverlay.classList.toggle('hidden');
    };
    
    const populateResultsTable = (topFoods) => {
        const resultsTbody = document.getElementById('results-tbody');
        if (!resultsTbody) return;
        resultsTbody.innerHTML = '';
        if (!topFoods || topFoods.length === 0) return;
        topFoods.forEach((food, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>#${index + 1}</td>
                <td>${food.name}</td>
                <td>${food.cuisine}</td>
                <td>
                    <input type="checkbox" data-name="${food.name}" data-cuisine="${food.cuisine}">
                </td>
            `;
            resultsTbody.appendChild(tr);
        });
        setTimeout(syncCheckboxesWithCart, 100);
    };

    const savedRoomId = sessionStorage.getItem('hbi_roomId');
    const savedName = sessionStorage.getItem('hbi_name');
    if (savedRoomId && savedName) {
        socket.emit('joinRoom', { name: savedName, roomId: savedRoomId });
    }

    document.getElementById('create-new-btn')?.addEventListener('click', () => {
        const name = nameInput.value.trim();
        if (!name) return errorMessage.textContent = 'Please enter your name.';
        socket.emit('createRoom', { name });
    });
    
    document.getElementById('join-room-toggle-btn')?.addEventListener('click', () => {
        document.getElementById('join-room-section').classList.toggle('hidden');
    });

    document.getElementById('join-room-btn')?.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const roomId = document.getElementById('room-id-input').value.trim().toUpperCase();
        if (!name || !roomId) return;
        socket.emit('joinRoom', { name, roomId });
    });

    document.querySelectorAll('.btn-cuisine').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
        });
    });

    document.getElementById('force-submit-btn')?.addEventListener('click', (e) => {
        const roomId = sessionStorage.getItem('hbi_roomId');
        socket.emit('forceSubmitCuisines', { roomId });
        waitingOverlay.classList.remove('hidden');
        e.target.disabled = true;
        document.getElementById('submit-cuisines-btn').disabled = true;
    });

    document.getElementById('start-blend-btn')?.addEventListener('click', (e) => {
        e.target.disabled = true;
        const roomId = sessionStorage.getItem('hbi_roomId');
        socket.emit('startCuisineSelection', { roomId });
    });

    document.getElementById('submit-cuisines-btn')?.addEventListener('click', (e) => {
        const selectedCuisines = [...document.querySelectorAll('.btn-cuisine.selected')].map(b => b.dataset.cuisine);
        if (selectedCuisines.length === 0) return alert('Please select at least one cuisine.');
        const roomId = sessionStorage.getItem('hbi_roomId');
        socket.emit('submitCuisines', { roomId, cuisines: selectedCuisines });
        waitingOverlay.classList.remove('hidden');
        e.target.disabled = true;
        const forceSubmitBtn = document.getElementById('force-submit-btn');
        if (forceSubmitBtn) forceSubmitBtn.disabled = true;
    });

    document.getElementById('results-tbody')?.addEventListener('change', (event) => {
        if (event.target.type === 'checkbox') {
            const foodName = event.target.dataset.name;
            const foodCuisine = event.target.dataset.cuisine;
            const isChecked = event.target.checked;
            const roomId = sessionStorage.getItem('hbi_roomId');
            socket.emit('updateGlobalList', { roomId, foodName, foodCuisine, isChecked });
        }
    });
    
    listNavButton?.addEventListener('click', toggleListOverlay);
    document.getElementById('go-to-list-btn')?.addEventListener('click', toggleListOverlay);
    closeListBtn?.addEventListener('click', toggleListOverlay);
    listOverlay?.addEventListener('click', (e) => {
        if (e.target === listOverlay) toggleListOverlay();
    });
    
    homeButtons.forEach(btn => btn.addEventListener('click', () => {
        sessionStorage.clear();
        window.location.reload();
    }));

    const handleRoomEntry = (data) => {
        sessionStorage.setItem('hbi_roomId', data.roomId);
        sessionStorage.setItem('hbi_name', data.name);
        foodCart = data.foodCart || [];
        masterFoodList = data.masterFoodList || [];
        const roomIdDisplay = document.getElementById('room-id-display');
        if (roomIdDisplay) roomIdDisplay.textContent = data.roomId;
        showScreen('waiting-screen');
        setTimeout(() => updatePlayerList(data.players), 50);
    };

    socket.on('roomCreated', handleRoomEntry);
    socket.on('roomJoined', handleRoomEntry);
    
    socket.on('rejoinSuccess', (data) => {
        handleRoomEntry(data);
        if(data.gameState === 'cuisines') showScreen('cuisine-screen');
        if(data.gameState === 'rating') showScreen('rating-screen');
        if(data.gameState === 'results') {
            showScreen('results-screen');
            populateResultsTable(data.finalResults);
        }
    });

    socket.on('playerJoined', ({ players }) => updatePlayerList(players));
    socket.on('playerDisconnected', ({ players }) => updatePlayerList(players));
    socket.on('playerReconnected', ({ players }) => updatePlayerList(players));
    
    socket.on('navigateToCuisines', () => showScreen('cuisine-screen'));

    socket.on('navigateToCompiling', () => {
        waitingOverlay.classList.add('hidden');
        showScreen('compiling-screen');
    });
    
    socket.on('globalListUpdated', (updatedList) => {
        foodCart = updatedList;
        syncCheckboxesWithCart();
        if (listOverlay && !listOverlay.classList.contains('hidden')) {
            renderList();
        }
    });

    socket.on('startBlend', ({ foodList }) => {
        waitingOverlay.classList.add('hidden');
        let currentFoodIndex = 0;
        let userRatings = [];
        const foodItemCard = document.getElementById('food-item-card');
        const ratingSlider = document.getElementById('rating-slider');
        const ratingNextBtn = document.getElementById('rating-next-btn');
        const blendBtn = document.getElementById('blend-btn');
        
        const displayFoodItem = () => {
            if (!foodItemCard) return;
            const food = foodList[currentFoodIndex];
            foodItemCard.innerHTML = `<img src="${food.image}" alt="${food.name}"><h2>${food.name}</h2>`;
            ratingSlider.value = 3;
            const isLastItem = currentFoodIndex === foodList.length - 1;
            const enoughItemsRated = currentFoodIndex >= 4;
            ratingNextBtn.style.display = isLastItem ? 'none' : 'inline-block';
            blendBtn.style.display = (isLastItem || enoughItemsRated) ? 'inline-block' : 'none';
        };

        ratingNextBtn.onclick = () => {
            userRatings.push({ ...foodList[currentFoodIndex], rating: parseInt(ratingSlider.value) });
            currentFoodIndex++;
            displayFoodItem();
        };

        blendBtn.onclick = () => {
            userRatings.push({ ...foodList[currentFoodIndex], rating: parseInt(ratingSlider.value) });
            const roomId = sessionStorage.getItem('hbi_roomId');
            socket.emit('submitRatings', { roomId, ratings: userRatings });
            waitingOverlay.classList.remove('hidden');
            document.getElementById('rating-buttons').classList.add('hidden');
        };

        displayFoodItem();
        showScreen('rating-screen');
    });

    socket.on('forceBlendReady', () => {
        if (isHost) {
            const forceSubmitBtn = document.getElementById('force-submit-btn');
            if (forceSubmitBtn) {
                forceSubmitBtn.classList.remove('hidden');
            }
        }
    });    
    socket.on('resultsCompiled', ({ topFoods }) => {
        showScreen('results-screen');
        populateResultsTable(topFoods);
    });

    socket.on('error', ({ message }) => {
        if (errorMessage) errorMessage.textContent = message;
        sessionStorage.clear();
    });

    showScreen('home-screen');
});
