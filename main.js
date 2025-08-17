class Game {
    constructor() {
        this.gameEngine = new GameEngine();
        this.aiIntegration = new AIIntegration();
        // Speed control removed - AI thinking time makes intervals irrelevant
        this.isProcessingTurn = false; // Prevent parallel turn processing

        this.initializeUI();
        this.setupEventListeners();
        this.loadApiKey();
        this.updateUI();
    }

    initializeUI() {
        const canvas = document.getElementById('gameCanvas');
        this.gameEngine.initCanvas(canvas);
        
        // Update model names in UI
        // Model names are now static color names
        
        // Update player stats
        this.updatePlayerStats();
    }

    setupEventListeners() {
        // Game controls
        document.getElementById('start-game').addEventListener('click', () => this.startGame());
        document.getElementById('next-turn').addEventListener('click', () => this.nextTurn());
        document.getElementById('pause-game').addEventListener('click', () => this.pauseGame());
        document.getElementById('reset-game').addEventListener('click', () => this.resetGame());
        
        // Speed control removed - AI thinking time makes intervals irrelevant
        
        // API key
        document.getElementById('save-key').addEventListener('click', () => this.saveApiKey());
        document.getElementById('openrouter-key').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveApiKey();
        });

        // Canvas clicks for debugging/inspection
        document.getElementById('gameCanvas').addEventListener('click', (e) => {
            this.handleCanvasClick(e);
        });
    }

    loadApiKey() {
        const savedKey = localStorage.getItem('openrouter_api_key');
        if (savedKey) {
            document.getElementById('openrouter-key').value = savedKey;
            this.aiIntegration.setApiKey(savedKey);
        }
    }

    async saveApiKey() {
        const keyInput = document.getElementById('openrouter-key');
        const key = keyInput.value.trim();
        
        if (!key) {
            this.showMessage('Пожалуйста, введите API ключ', 'error');
            return;
        }

        this.aiIntegration.setApiKey(key);
        
        try {
            await this.aiIntegration.testConnection();
            this.showMessage('✅ API ключ сохранен и проверен', 'success');
        } catch (error) {
            this.showMessage(`❌ Ошибка API: ${error.message}`, 'error');
        }
    }

    async startGame() {
        if (!this.aiIntegration.getApiKey()) {
            this.showMessage('Сначала настройте API ключ OpenRouter', 'error');
            return;
        }

        try {
            await this.aiIntegration.testConnection();
        } catch (error) {
            this.showMessage(`Ошибка подключения к API: ${error.message}`, 'error');
            return;
        }

        this.isProcessingTurn = false; // Reset turn processing flag at start
        this.gameEngine.startGame();
        this.updateUI();
        this.showMessage('🚀 Игра началась!', 'success');
        
        // Auto-play removed - manual turns only
    }

    async nextTurn() {
        if (this.gameEngine.gameState !== 'running') return;
        
        // Prevent parallel turn processing
        if (this.isProcessingTurn) {
            console.log('⏳ Turn already in progress, skipping...');
            return;
        }
        
        this.isProcessingTurn = true;
        console.log('🔒 Turn processing started');
        
        // Add timeout to prevent infinite hanging
        const turnTimeout = setTimeout(() => {
            console.log('⏰ Turn timeout! Force reset processing flag');
            this.isProcessingTurn = false;
        }, 60000); // 60 seconds timeout (1 minute)

        // Get current player FRESH each time (don't cache it)
        let currentPlayer = this.gameEngine.getCurrentPlayer();
        
        try {
            console.log(`🎲 Processing turn for player: ${currentPlayer.name} (index: ${this.gameEngine.currentPlayerIndex})`);
            
            this.showMessage(`🤖 ${currentPlayer.name} размышляет...`, 'info');
            this.setUILoading(true);
            
            const gameState = this.gameEngine.getGameStateForAI(currentPlayer.id);
            console.log(`📤 Sending request for player: ${gameState.playerId} (currentPlayer: ${currentPlayer.id})`);
            
            let decision;
            try {
                decision = await this.aiIntegration.queueRequest(gameState, this.gameEngine);
            } catch (error) {
                if (error.message.includes('Request cancelled') || error.message.includes('Stale request')) {
                    console.log(`🚫 Request cancelled/stale for ${currentPlayer.name}, skipping turn`);
                    this.isProcessingTurn = false;
                    return;
                }
                throw error; // Re-throw other errors
            }
            
            // DON'T change currentPlayer - use the original player who made the decision
            // currentPlayer stays the same as the one who made the decision
            
            // Log AI decision
            console.log(`${currentPlayer.name} decision:`, decision);
            if (decision.reasoning) {
                this.gameEngine.addLogEntry(`💭 ${currentPlayer.name}: ${decision.reasoning}`);
            } else {
                this.gameEngine.addLogEntry(`🤖 ${currentPlayer.name} сделал ход без объяснения`);
            }
            
            // Execute AI decision
            const success = this.gameEngine.makeMove(currentPlayer.id, decision.moves, decision.diplomacy);
            
            if (success) {
                this.gameEngine.draw();
                console.log(`✅ Turn completed successfully for ${currentPlayer.name}`);
                
                // Move to next player AFTER successful move execution
                this.gameEngine.nextTurn();
                this.updateUI(); // Update UI AFTER changing player
            } else {
                console.log(`❌ Move failed for ${currentPlayer.name}`);
                this.showMessage(`Ошибка выполнения хода ${currentPlayer.name}`, 'error');
                
                // Force next turn if move failed
                this.gameEngine.nextTurn();
                this.updateUI(); // Update UI AFTER changing player
            }
            
        } catch (error) {
            console.error(`Error processing turn for ${currentPlayer.name}:`, error);
            this.showMessage(`Ошибка ИИ ${currentPlayer.name}: ${error.message}`, 'error');
            
            // Skip turn on error
            this.gameEngine.nextTurn();
            this.updateUI(); // Update UI AFTER changing player
        } finally {
            clearTimeout(turnTimeout); // Clear timeout if turn completed normally
            this.setUILoading(false);
            this.isProcessingTurn = false;
            console.log('🔓 Turn processing finished');
        }
        
        // Check if game ended
        if (this.gameEngine.gameState === 'finished') {
            this.stopAutoPlay();
            this.showMessage('🏁 Игра завершена!', 'success');
        }
    }

    pauseGame() {
        if (this.gameEngine.gameState === 'running') {
            this.gameEngine.pauseGame();
            this.isProcessingTurn = false; // Reset turn processing on pause
        } else if (this.gameEngine.gameState === 'paused') {
            this.gameEngine.resumeGame();
        }
        this.updateUI();
    }

    resetGame() {
        this.isProcessingTurn = false; // Reset turn processing flag
        this.gameEngine.resetGame();
        this.updateUI();
        this.showMessage('🔄 Игра сброшена', 'info');
    }

    // Auto-play functions removed - AI thinking time makes speed control irrelevant

    // Model names are now static color names - no dynamic naming needed

    // getModelDisplayName removed - using static color names now

    updateUI() {
        // Model names are now static color names
        this.updateCurrentPlayer();
        this.updatePlayerStats();
        this.updateControls();
    }

    updateCurrentPlayer() {
        const currentPlayer = this.gameEngine.getCurrentPlayer();
        const currentPlayerElement = document.getElementById('current-player');
        const turnNumberElement = document.getElementById('turn-number');
        
        if (currentPlayerElement) {
            currentPlayerElement.textContent = currentPlayer.name;
            currentPlayerElement.style.background = currentPlayer.color;
        }
        
        if (turnNumberElement) {
            turnNumberElement.textContent = this.gameEngine.currentTurn + 1;
        }
    }

    updatePlayerStats() {
        this.gameEngine.players.forEach(player => {
            const unitsElement = document.getElementById(`${player.id}-units`);
            const liesElement = document.getElementById(`${player.id}-lies`);
            
            if (unitsElement) {
                unitsElement.textContent = player.units;
            }
            
            if (liesElement) {
                liesElement.textContent = player.lies;
            }
            
            // Update player card style based on status
            const playerCard = document.querySelector(`.player.${player.id}`);
            if (playerCard) {
                if (player.units === 0) {
                    playerCard.style.opacity = '0.5';
                    playerCard.style.filter = 'grayscale(100%)';
                } else {
                    playerCard.style.opacity = '1';
                    playerCard.style.filter = 'none';
                }
            }
        });
    }

    updateControls() {
        const startButton = document.getElementById('start-game');
        const nextButton = document.getElementById('next-turn');
        const pauseButton = document.getElementById('pause-game');
        const resetButton = document.getElementById('reset-game');
        
        switch (this.gameEngine.gameState) {
            case 'waiting':
                startButton.disabled = false;
                nextButton.disabled = true;
                pauseButton.disabled = true;
                pauseButton.textContent = '⏸️ Пауза';
                break;
                
            case 'running':
                startButton.disabled = true;
                nextButton.disabled = this.autoPlay;
                pauseButton.disabled = false;
                pauseButton.textContent = '⏸️ Пауза';
                break;
                
            case 'paused':
                startButton.disabled = true;
                nextButton.disabled = false;
                pauseButton.disabled = false;
                pauseButton.textContent = '▶️ Продолжить';
                break;
                
            case 'finished':
                startButton.disabled = true;
                nextButton.disabled = true;
                pauseButton.disabled = true;
                pauseButton.textContent = '⏸️ Пауза';
                break;
        }
    }

    setUILoading(loading) {
        const controls = document.querySelector('.controls');
        if (loading) {
            controls.classList.add('loading');
        } else {
            controls.classList.remove('loading');
        }
    }

    handleCanvasClick(event) {
        const canvas = document.getElementById('gameCanvas');
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((event.clientX - rect.left) / this.gameEngine.cellSize);
        const y = Math.floor((event.clientY - rect.top) / this.gameEngine.cellSize);
        
        if (x >= 0 && x < 10 && y >= 0 && y < 10) {
            // Debug: show cell info
            const cell = this.gameEngine.board[y][x];
            console.log(`Cell (${x},${y}):`, cell);
            
            if (cell.units.length > 0) {
                const unitsInfo = cell.units.map(u => `${u.player}:${u.count}`).join(', ');
                this.showMessage(`Клетка (${x},${y}): ${unitsInfo}`, 'info');
            } else {
                this.showMessage(`Клетка (${x},${y}): пустая`, 'info');
            }
        }
    }

    showMessage(message, type = 'info') {
        // Create temporary message display
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 5px;
            z-index: 1000;
            font-weight: bold;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        
        switch (type) {
            case 'success':
                messageDiv.style.background = '#d4edda';
                messageDiv.style.color = '#155724';
                messageDiv.style.border = '1px solid #c3e6cb';
                break;
            case 'error':
                messageDiv.style.background = '#f8d7da';
                messageDiv.style.color = '#721c24';
                messageDiv.style.border = '1px solid #f5c6cb';
                break;
            case 'info':
            default:
                messageDiv.style.background = '#d1ecf1';
                messageDiv.style.color = '#0c5460';
                messageDiv.style.border = '1px solid #bee5eb';
                break;
        }
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 5000);
    }

    // Debug methods
    async debugAI(playerId) {
        const player = this.gameEngine.players.find(p => p.id === playerId);
        if (!player) return;
        
        const gameState = this.gameEngine.getGameStateForAI(playerId);
        console.log(`Game state for ${player.name}:`, gameState);
        
        try {
            const decision = await this.aiIntegration.makeAIDecision(gameState, this.gameEngine);
            console.log(`AI decision for ${player.name}:`, decision);
        } catch (error) {
            console.error(`AI error for ${player.name}:`, error);
        }
    }

    async getModelStatus() {
        try {
            const status = await this.aiIntegration.getModelStatus();
            console.log('Model status:', status);
            return status;
        } catch (error) {
            console.error('Error getting model status:', error);
        }
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new Game();
    
    // Expose debug functions to console
    window.debugAI = (playerId) => window.game.debugAI(playerId);
    window.getModelStatus = () => window.game.getModelStatus();
    window.debugBoard = () => window.game.gameEngine.debugBoardState();
    window.debugDiplomacy = (playerId) => window.game.gameEngine.debugDiplomacy(playerId);
    window.resetTurnProcessing = () => {
        console.log('🔧 Emergency reset: clearing turn processing flag');
        window.game.isProcessingTurn = false;
        window.game.setUILoading(false);
        window.game.showMessage('🔧 Обработка ходов разблокирована', 'info');
    };
    
    console.log('🎮 AI Strategic Battle loaded!');
    console.log('Debug commands:');
    console.log('- debugAI("blue") - test AI decision for Blue (or "yellow", "gray", "green")');
    console.log('- getModelStatus() - check model availability');
    console.log('- debugBoard() - show current board state');
    console.log('- debugDiplomacy() - show all diplomacy history');
    console.log('- debugDiplomacy("blue") - show diplomacy for specific player');
    // testModelNaming removed - using static color names now
    console.log('- resetTurnProcessing() - emergency reset if game hangs');
});