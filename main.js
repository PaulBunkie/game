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
        
        // Update model names in UI - DYNAMIC from ai-integration.js
        this.updateModelNames();
        
        // Update player stats
        this.updatePlayerStats();
    }

    // Extract short model name from full model path
    getShortModelName(fullModelName) {
        // Extract key parts from model names like "microsoft/mai-ds-r1:free"
        if (fullModelName.includes('mai-ds')) return 'mai-ds';
        if (fullModelName.includes('llama')) return 'llama-3.3';
        if (fullModelName.includes('gpt-oss')) return 'gpt-oss';
        if (fullModelName.includes('qwen')) return 'qwen3';
        if (fullModelName.includes('deepseek')) return 'deepseek';
        if (fullModelName.includes('gemini')) return 'gemini';
        if (fullModelName.includes('mistral')) return 'mistral';
        if (fullModelName.includes('claude')) return 'claude';
        if (fullModelName.includes('grok')) return 'grok';
        
        // Fallback - extract name between '/' and ':'
        const parts = fullModelName.split('/');
        if (parts.length > 1) {
            const modelPart = parts[1].split(':')[0];
            return modelPart.substring(0, 10); // Limit length
        }
        
        return 'unknown';
    }

    // DYNAMIC: Update model names in player cards from ai-integration.js
    updateModelNames() {
        const colors = ['blue', 'yellow', 'green', 'gray'];
        colors.forEach(color => {
            const modelElement = document.getElementById(`${color}-model`);
            if (modelElement && this.aiIntegration.models[color]) {
                const fullModelName = this.aiIntegration.models[color];
                const shortName = this.getShortModelName(fullModelName);
                modelElement.textContent = shortName;
                console.log(`🎯 Updated ${color} model: ${fullModelName} → ${shortName}`);
            } else {
                console.warn(`⚠️ Model element not found for color: ${color}`);
            }
        });
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
        
        // Add initial commentator entry
        try {
            const commentary = await this.aiIntegration.generateCommentary(this.gameEngine);
            this.gameEngine.addCommentatorEntry(commentary, 0);
        } catch (error) {
            console.error(`❌ Error generating initial commentary:`, error);
            this.gameEngine.addCommentatorEntry("Игра начинается! Все игроки готовы к битве!", 0);
        }
        
        // AUTO-PLAY: Start first turn immediately
        this.nextTurn();
    }

    async nextTurn() {
        if (this.gameEngine.gameState !== 'running') {
            console.log(`⏸️ Game not running, state: ${this.gameEngine.gameState}`);
            return;
        }
        
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
        }, 120000); // 120 seconds timeout (2 minutes)

        // Get current player FRESH each time (don't cache it)
        let currentPlayer = this.gameEngine.getCurrentPlayer();
        
        // Check if there are any alive players
        if (!currentPlayer) {
            console.log('☠️ No alive players found, ending game');
            this.gameEngine.gameState = 'finished';
            this.showMessage('☠️ Все игроки уничтожены. Игра завершена!', 'info');
            this.setUILoading(false);
            this.isProcessingTurn = false;
            return;
        }
        
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
            console.log(`🔍 AI moves details:`, decision.moves);
            if (decision.moves && decision.moves.length > 0) {
                decision.moves.forEach((move, index) => {
                    console.log(`📋 Move ${index + 1}: from(${move.fromX},${move.fromY}) to(${move.toX},${move.toY}) units:${move.unitCount}`);
                });
            }
            
            if (decision.reasoning) {
                this.gameEngine.addLogEntry(`💭 ${currentPlayer.name}: ${decision.reasoning}`);
            } else {
                this.gameEngine.addLogEntry(`🤖 ${currentPlayer.name} сделал ход без объяснения`);
            }
            
            // Execute AI decision
            const success = this.gameEngine.makeMove(currentPlayer.id, decision.moves, decision.diplomacy);
            
            // Generate commentator commentary
            try {
                const lastMove = {
                    playerName: currentPlayer.name,
                    movesCount: decision.moves ? decision.moves.length : 0,
                    diplomacyCount: decision.diplomacy ? decision.diplomacy.length : 0
                };
                
                const commentary = await this.aiIntegration.generateCommentary(this.gameEngine, lastMove);
                this.gameEngine.addCommentatorEntry(commentary, this.gameEngine.currentTurn);
                console.log(`🎤 Commentator: ${commentary}`);
            } catch (error) {
                console.error(`❌ Error generating commentary:`, error);
                // Add fallback commentary
                this.gameEngine.addCommentatorEntry("Комментатор анализирует ситуацию...", this.gameEngine.currentTurn);
            }
            
            // Check if game ended after this move
            if (this.gameEngine.gameState === 'finished') {
                console.log(`🏁 Game ended after ${currentPlayer.name}'s move`);
                this.gameEngine.draw();
                this.updateUI();
                return; // Don't continue to next turn
            }
            
            // Always proceed to next turn (moves are now optional)
            this.gameEngine.draw();
            console.log(`✅ Turn completed for ${currentPlayer.name} (moves: ${decision.moves ? decision.moves.length : 0})`);
            
            // Move to next player
            this.gameEngine.nextTurn();
            this.updateUI(); // Update UI AFTER changing player
            
        } catch (error) {
            console.error(`Error processing turn for ${currentPlayer.name}:`, error);
            this.showMessage(`Ошибка ИИ ${currentPlayer.name}: ${error.message}`, 'error');
            
            // Skip turn on error
            this.gameEngine.nextTurn();
            
            // Check if game ended after error
            if (this.gameEngine.gameState === 'finished') {
                console.log(`🏁 Game ended after error in ${currentPlayer.name}'s turn`);
                this.updateUI();
                return; // Don't continue
            }
            
            this.updateUI(); // Update UI AFTER changing player
        } finally {
            clearTimeout(turnTimeout); // Clear timeout if turn completed normally
            this.setUILoading(false);
            this.isProcessingTurn = false;
            console.log('🔓 Turn processing finished');
        }
        
        // Check if game ended or paused
        if (this.gameEngine.gameState === 'finished') {
            this.stopAutoPlay();
            this.showMessage('🏁 Игра завершена!', 'success');
            console.log('🏁 Game finished, stopping auto-play');
        } else if (this.gameEngine.gameState === 'running') {
            // AUTO-PLAY: Automatically continue to next turn immediately (only if game is still running)
            console.log('🔄 Auto-continuing to next turn...');
            this.nextTurn();
        } else if (this.gameEngine.gameState === 'paused') {
            console.log('⏸️ Game paused, not auto-continuing');
        } else {
            console.log(`🔄 Not auto-continuing: game state is ${this.gameEngine.gameState}`);
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

    stopAutoPlay() {
        // Stub function - auto-play is now built into nextTurn()
        console.log('🛑 Auto-play stopped (game ended)');
    }

    resetGame() {
        this.isProcessingTurn = false; // Reset turn processing flag
        this.gameEngine.resetGame();
        this.updateUI();
        this.showMessage('🔄 Игра сброшена', 'info');
    }

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
            
            if (unitsElement) {
                unitsElement.textContent = player.units;
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
        
        // Reset button is always enabled for safety
        if (resetButton) {
            resetButton.disabled = false;
        }
        
        switch (this.gameEngine.gameState) {
            case 'waiting':
                startButton.disabled = false;
                nextButton.disabled = true;
                pauseButton.disabled = true;
                pauseButton.textContent = '⏸️ Пауза';
                break;
                
            case 'running':
                startButton.disabled = true;
                nextButton.disabled = false; // Always allow manual next turn
                pauseButton.disabled = false; // Always allow pause
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
        if (loading) {
            // During AI thinking: disable only action buttons, keep pause/reset enabled
            const startButton = document.getElementById('start-game');
            const nextButton = document.getElementById('next-turn');
            if (startButton) startButton.disabled = true;
            if (nextButton) nextButton.disabled = true;
            
            // IMPORTANT: Keep pause and reset buttons always enabled
            const pauseButton = document.getElementById('pause-game');
            const resetButton = document.getElementById('reset-game');
            if (pauseButton) pauseButton.disabled = false;
            if (resetButton) resetButton.disabled = false;
            
            // Show visual feedback without blocking interactions
            const controls = document.querySelector('.controls');
            if (controls) controls.classList.add('loading');
        } else {
            // AI thinking finished: restore normal button states
            const controls = document.querySelector('.controls');
            if (controls) controls.classList.remove('loading');
            
            // Let updateControls handle the proper button states
            this.updateControls();
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
    window.debugPlayerVisibility = (playerId) => window.game.gameEngine.debugPlayerVisibility(playerId);
    window.debugPlayerStatus = () => window.game.gameEngine.debugPlayerStatus();
    window.testBaseCapture = () => window.game.gameEngine.testBaseCapture();
    window.testCommentator = () => window.game.aiIntegration.generateCommentary(window.game.gameEngine);
    window.resetTurnProcessing = () => {
        console.log('🔧 Emergency reset: clearing turn processing flag');
        window.game.isProcessingTurn = false;
        window.game.setUILoading(false);
        window.game.showMessage('🔧 Обработка ходов разблокирована', 'info');
    };
    
    console.log('🎮 AI Strategic Battle loaded!');
    console.log('Debug commands:');
    console.log('- debugAI("blue") - test AI decision for Blue (or "yellow", "green", "gray")');
    console.log('- getModelStatus() - check model availability');
    console.log('- debugBoard() - show current board state');
    console.log('- debugDiplomacy() - show all diplomacy history');
    console.log('- debugDiplomacy("blue") - show diplomacy for specific player');
    console.log('- debugPlayerVisibility("blue") - show what Blue player can see');
    console.log('- debugPlayerStatus() - show detailed player status and game state');
    console.log('- testBaseCapture() - test base capture logic');
    console.log('- testCommentator() - test commentator functionality');
    // testModelNaming removed - using static color names now
    console.log('- resetTurnProcessing() - emergency reset if game hangs (timeout: 2 minutes)');
});