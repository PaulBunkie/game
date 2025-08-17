class GameEngine {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.gameState = 'waiting'; // waiting, running, paused, finished
        this.currentTurn = 0;
        this.currentPlayerIndex = 0;
        this.players = [
            {
                id: 'blue',
                name: 'Синий',
                color: '#4285f4',
                units: 10,
                startPosition: { x: 0, y: 0 },
                quadrant: { startX: 0, startY: 0, endX: 4, endY: 4 },
                diplomacyHistory: []
            },
            {
                id: 'yellow',
                name: 'Желтый',
                color: '#ffd700',
                units: 10,
                startPosition: { x: 9, y: 0 },
                quadrant: { startX: 5, startY: 0, endX: 9, endY: 4 },
                diplomacyHistory: []
            },
            {
                id: 'green',
                name: 'Зеленый',
                color: '#34a853',
                units: 10,
                startPosition: { x: 9, y: 9 },
                quadrant: { startX: 5, startY: 5, endX: 9, endY: 9 },
                diplomacyHistory: []
            },
            {
                id: 'gray',
                name: 'Серый',
                color: '#6c757d',
                units: 10,
                startPosition: { x: 0, y: 9 },
                quadrant: { startX: 0, startY: 5, endX: 4, endY: 9 },
                diplomacyHistory: []
            }
        ];

        // Game board: 10x10 grid
        this.board = Array(10).fill().map((row, y) => Array(10).fill().map((cell, x) => ({
            units: [],
            visible: {}, // visibility for each player
            resourceCell: (x >= 4 && x <= 5 && y >= 4 && y <= 5), // Central resource cells
            depleted: false // Whether the resource has been claimed
        })));

        this.cellSize = 60;
        this.animationQueue = [];
        this.isAnimating = false;

        this.initializeBoard();
        this.setupEventListeners();
    }

    initializeBoard() {
        // Place initial units in corners
        this.players.forEach(player => {
            const { x, y } = player.startPosition;
            this.board[y][x].units.push({
                player: player.id,
                count: player.units
            });
        });

        // Initialize visibility (fog of war)
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                this.players.forEach(player => {
                    this.board[y][x].visible[player.id] = false;
                });
            }
        }

        // Set initial visibility for starting positions
        this.updateVisibility();
    }

    setupEventListeners() {
        // Canvas will be set up in main.js
    }

    initCanvas(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.draw();
    }

    updateVisibility() {
        // Reset visibility
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                this.players.forEach(player => {
                    this.board[y][x].visible[player.id] = false;
                });
            }
        }

        // Central resource cells are always visible to all players
        const centralCells = [
            { x: 4, y: 4 }, { x: 4, y: 5 },
            { x: 5, y: 4 }, { x: 5, y: 5 }
        ];
        
        centralCells.forEach(({ x, y }) => {
            this.players.forEach(player => {
                this.setVisibility(x, y, player.id, true);
            });
        });

        // Update visibility based on unit positions
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const cell = this.board[y][x];
                if (cell.units.length > 0) {
                    cell.units.forEach(unit => {
                        // Player can see their own units and adjacent cells
                        this.setVisibility(x, y, unit.player, true);
                        
                        // Check adjacent cells
                        const adjacent = [
                            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
                            { dx: 0, dy: -1 }, { dx: 0, dy: 1 }
                        ];

                        adjacent.forEach(({ dx, dy }) => {
                            const newX = x + dx;
                            const newY = y + dy;
                            if (newX >= 0 && newX < 10 && newY >= 0 && newY < 10) {
                                this.setVisibility(newX, newY, unit.player, true);
                            }
                        });
                    });
                }
            }
        }
    }

    setVisibility(x, y, playerId, visible) {
        if (x >= 0 && x < 10 && y >= 0 && y < 10) {
            this.board[y][x].visible[playerId] = visible;
        }
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }



    makeMove(playerId, moves, diplomaticMessage) {
        console.log(`🎯 makeMove called for ${playerId}, gameState: ${this.gameState}`);
        
        if (this.gameState !== 'running') {
            console.log(`❌ Game not running, state: ${this.gameState}`);
            return false;
        }
        
        const currentPlayer = this.getCurrentPlayer();
        console.log(`👤 Current player: ${currentPlayer.id}, requested: ${playerId}`);
        
        if (currentPlayer.id !== playerId) {
            console.log(`❌ Wrong player turn! Expected: ${currentPlayer.id}, got: ${playerId}`);
            return false;
        }

        console.log(`🔍 Validating ${moves.length} moves for ${playerId}:`, moves);
        
        // Validate and execute moves
        const validMoves = this.validateMoves(moves, playerId);
        console.log(`✅ Valid moves: ${validMoves.length}/${moves.length}`, validMoves);
        
        // Allow turn without moves (optional movement)
        if (validMoves.length === 0) {
            console.log(`ℹ️ ${playerId} passed turn without moving units`);
        }

        if (validMoves.length > 0) {
            console.log(`⚡ Executing moves for ${playerId}`);
            this.executeMoves(validMoves, playerId);
        }
        
        if (diplomaticMessage) {
            console.log(`💬 Processing diplomacy for ${playerId}:`, diplomaticMessage);
            
            // Handle both single message (legacy) and array of messages
            if (Array.isArray(diplomaticMessage)) {
                // Process each message in the array (max 2)
                diplomaticMessage.forEach(msg => {
                    this.processDiplomaticMessage(msg);
                });
            } else {
                // Legacy single message support
                this.processDiplomaticMessage(diplomaticMessage);
            }
        }
        
        this.updateVisibility();
        this.checkGameEnd();
        
        this.addLogEntry(`✅ ${currentPlayer.name} завершил ход`);
        return true;
    }

    validateMoves(moves, playerId) {
        const validMoves = [];
        
        moves.forEach((move, index) => {
            const { fromX, fromY, toX, toY, unitCount } = move;
            console.log(`🔍 Validating move ${index + 1}: (${fromX},${fromY}) → (${toX},${toY}), units: ${unitCount}`);
            
            // Check bounds
            if (fromX < 0 || fromX >= 10 || fromY < 0 || fromY >= 10 ||
                toX < 0 || toX >= 10 || toY < 0 || toY >= 10) {
                console.log(`❌ Move ${index + 1}: Out of bounds`);
                return;
            }
            
            // Check if move is adjacent (only horizontal/vertical)
            const dx = Math.abs(toX - fromX);
            const dy = Math.abs(toY - fromY);
            if (dx + dy !== 1) {
                console.log(`❌ Move ${index + 1}: Not adjacent (dx=${dx}, dy=${dy})`);
                return;
            }
            
            // Check if player has units at source
            const sourceCell = this.board[fromY][fromX];
            const playerUnit = sourceCell.units.find(u => u.player === playerId);
            
            console.log(`🔍 Source cell (${fromX},${fromY}) units:`, sourceCell.units);
            console.log(`🔍 Player ${playerId} unit at source:`, playerUnit);
            
            if (!playerUnit) {
                console.log(`❌ Move ${index + 1}: No units for player ${playerId} at (${fromX},${fromY})`);
                return;
            }
            
            if (playerUnit.count < unitCount) {
                console.log(`❌ Move ${index + 1}: Not enough units (has ${playerUnit.count}, needs ${unitCount})`);
                return;
            }
            
            console.log(`✅ Move ${index + 1}: Valid!`);
            validMoves.push(move);
        });
        
        return validMoves;
    }

    executeMoves(moves, playerId) {
        moves.forEach(move => {
            const { fromX, fromY, toX, toY, unitCount } = move;
            
            const sourceCell = this.board[fromY][fromX];
            const targetCell = this.board[toY][toX];
            
            // Remove units from source
            const playerUnit = sourceCell.units.find(u => u.player === playerId);
            playerUnit.count -= unitCount;
            if (playerUnit.count === 0) {
                sourceCell.units = sourceCell.units.filter(u => u.player !== playerId);
            }
            
            // Check for battle at target
            const enemyUnits = targetCell.units.filter(u => u.player !== playerId);
            if (enemyUnits.length > 0) {
                this.processBattle(toX, toY, playerId, unitCount, enemyUnits);
            } else {
                // No battle, just move
                const existingUnit = targetCell.units.find(u => u.player === playerId);
                if (existingUnit) {
                    existingUnit.count += unitCount;
                } else {
                    targetCell.units.push({ player: playerId, count: unitCount });
                }
            }
            
            // Check for resource capture
            if (targetCell.resourceCell && !targetCell.depleted) {
                const player = this.players.find(p => p.id === playerId);
                const playerHomeCell = this.board[player.startPosition.y][player.startPosition.x];
                
                // Add bonus unit to home position
                const existingHome = playerHomeCell.units.find(u => u.player === playerId);
                if (existingHome) {
                    existingHome.count += 1;
                } else {
                    playerHomeCell.units.push({ player: playerId, count: 1 });
                }
                
                // Mark resource as depleted
                targetCell.depleted = true;
                
                console.log(`💰 ${player.name} captured resource at (${toX},${toY})! +1 unit added to home base (${player.startPosition.x},${player.startPosition.y})`);
                this.addLogEntry(`💰 ${player.name} захватил ресурс на (${toX},${toY})! +1 дивизия в базе`);
            }
        });
        
        // Update player total units
        this.updatePlayerUnits();
    }

    processBattle(x, y, attackerId, attackerUnits, defenders) {
        const cell = this.board[y][x];
        let remainingAttackers = attackerUnits;
        
        // Battle against each defender
        defenders.forEach(defender => {
            const defenderUnits = defender.count;
            
            if (remainingAttackers > defenderUnits) {
                // Attacker wins
                remainingAttackers -= defenderUnits;
                cell.units = cell.units.filter(u => u.player !== defender.player);
            } else if (remainingAttackers < defenderUnits) {
                // Defender wins
                defender.count -= remainingAttackers;
                remainingAttackers = 0;
            } else {
                // Tie - both destroyed
                cell.units = cell.units.filter(u => u.player !== defender.player);
                remainingAttackers = 0;
            }
        });
        
        // Place remaining attackers if any
        if (remainingAttackers > 0) {
            const existingAttacker = cell.units.find(u => u.player === attackerId);
            if (existingAttacker) {
                existingAttacker.count += remainingAttackers;
            } else {
                cell.units.push({ player: attackerId, count: remainingAttackers });
            }
        }
        
        // Log battle
        this.logBattle(x, y, attackerId, attackerUnits, defenders, remainingAttackers);
    }

    logBattle(x, y, attackerId, attackerUnits, defenders, survivors) {
        const attacker = this.players.find(p => p.id === attackerId);
        const defenderNames = defenders.map(d => 
            this.players.find(p => p.id === d.player).name
        ).join(', ');
        
        const message = `⚔️ Битва на (${x},${y}): ${attacker.name} (${attackerUnits}) против ${defenderNames}. Выжили: ${survivors} из ${attacker.name}`;
        this.addLogEntry(message);
    }

    processDiplomaticMessage(message) {
        if (!message || !message.to || !message.content) return;
        
        const from = this.getCurrentPlayer();
        const to = this.players.find(p => p.id === message.to);
        
        if (!to) return;
        
        // Create diplomatic message record (no fact-checking)
        const diplomaticRecord = {
            turn: this.currentTurn,
            from: from.id,
            to: to.id,
            content: message.content,
            timestamp: Date.now()
        };
        
        // Add to sender's history (what they sent)
        from.diplomacyHistory.push({
            ...diplomaticRecord,
            type: 'sent'
        });
        
        // Add to receiver's history (what they received)
        to.diplomacyHistory.push({
            ...diplomaticRecord,
            type: 'received'
        });
        
        console.log(`💬 Diplomatic message saved: ${from.name} → ${to.name}: "${message.content}"`);
        
        this.addDiplomaticEntry(from, to, message.content);
    }



    updatePlayerUnits() {
        this.players.forEach(player => {
            let totalUnits = 0;
            for (let y = 0; y < 10; y++) {
                for (let x = 0; x < 10; x++) {
                    const unit = this.board[y][x].units.find(u => u.player === player.id);
                    if (unit) {
                        totalUnits += unit.count;
                    }
                }
            }
            player.units = totalUnits;
        });
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
        if (this.currentPlayerIndex === 0) {
            this.currentTurn++;
        }
    }

    checkGameEnd() {
        const alivePlayers = this.players.filter(p => p.units > 0);
        if (alivePlayers.length <= 1) {
            this.gameState = 'finished';
            if (alivePlayers.length === 1) {
                this.addLogEntry(`🏆 ${alivePlayers[0].name} побеждает!`);
            } else {
                this.addLogEntry('☠️ Все игроки уничтожены. Ничья!');
            }
        }
    }

    // Debug function to show current board state
    debugBoardState() {
        console.log('🗺️ Current board state:');
        for (let y = 0; y < 10; y++) {
            let row = `${y} `;
            for (let x = 0; x < 10; x++) {
                const cell = this.board[y][x];
                if (cell.units.length === 0) {
                    row += ' . ';
                } else {
                    const unit = cell.units[0];
                    const symbol = unit.player[0].toUpperCase();
                    row += `${symbol}${unit.count} `;
                }
            }
            console.log(row);
        }
        
        console.log('👥 Players status:');
        this.players.forEach(p => {
            console.log(`- ${p.name} (${p.id}): ${p.units} units, start at (${p.startPosition.x}, ${p.startPosition.y}), diplomacy: ${p.diplomacyHistory.length} messages`);
        });
    }

    // Debug function to show diplomacy history
    debugDiplomacy(playerId = null) {
        console.log('💬 Diplomacy History:');
        
        if (playerId) {
            // Show history for specific player
            const player = this.players.find(p => p.id === playerId);
            if (!player) {
                console.log(`❌ Player ${playerId} not found`);
                return;
            }
            
            console.log(`📜 ${player.name} diplomacy history (${player.diplomacyHistory.length} messages):`);
            player.diplomacyHistory.forEach((msg, index) => {
                const direction = msg.type === 'sent' ? '→' : '←';
                const otherPlayer = msg.type === 'sent' ? msg.to : msg.from;
                
                let lieInfo = '';
                if (msg.actuallyLied) {
                    lieInfo = ' [ЛОЖЬ ОБНАРУЖЕНА]';
                    if (msg.detectedLies && msg.detectedLies.length > 0) {
                        lieInfo += ` (${msg.detectedLies.join('; ')})`;
                    }
                }
                
                let claimInfo = '';
                if (msg.claimedLie !== undefined && msg.actuallyLied !== undefined) {
                    if (msg.claimedLie && !msg.actuallyLied) {
                        claimInfo = ' [ЗАЯВИЛ ЛОЖЬ, НО ГОВОРИЛ ПРАВДУ]';
                    } else if (!msg.claimedLie && msg.actuallyLied) {
                        claimInfo = ' [СКРЫЛ ЛОЖЬ]';
                    }
                }
                
                console.log(`${index + 1}. Ход ${msg.turn}: ${direction} ${otherPlayer}: "${msg.content}"${lieInfo}${claimInfo}`);
            });
        } else {
            // Show all diplomatic messages chronologically
            const allMessages = [];
            this.players.forEach(player => {
                player.diplomacyHistory.forEach(msg => {
                    if (msg.type === 'sent') {  // Only add sent messages to avoid duplicates
                        allMessages.push({
                            ...msg,
                            fromName: player.name,
                            toName: this.players.find(p => p.id === msg.to)?.name || 'Unknown'
                        });
                    }
                });
            });
            
            // Sort by turn
            allMessages.sort((a, b) => a.turn - b.turn);
            
            console.log(`📜 All diplomatic messages (${allMessages.length} total):`);
            allMessages.forEach((msg, index) => {
                let lieInfo = '';
                if (msg.actuallyLied) {
                    lieInfo = ' [ЛОЖЬ ОБНАРУЖЕНА]';
                    if (msg.detectedLies && msg.detectedLies.length > 0) {
                        lieInfo += ` (${msg.detectedLies.join('; ')})`;
                    }
                }
                
                let claimInfo = '';
                if (msg.claimedLie !== undefined && msg.actuallyLied !== undefined) {
                    if (msg.claimedLie && !msg.actuallyLied) {
                        claimInfo = ' [ЗАЯВИЛ ЛОЖЬ, НО ГОВОРИЛ ПРАВДУ]';
                    } else if (!msg.claimedLie && msg.actuallyLied) {
                        claimInfo = ' [СКРЫЛ ЛОЖЬ]';
                    }
                }
                
                console.log(`${index + 1}. Ход ${msg.turn}: ${msg.fromName} → ${msg.toName}: "${msg.content}"${lieInfo}${claimInfo}`);
            });
        }
    }

    getGameStateForAI(playerId) {
        const player = this.players.find(p => p.id === playerId);
        const visibleBoard = [];
        
        for (let y = 0; y < 10; y++) {
            visibleBoard[y] = [];
            for (let x = 0; x < 10; x++) {
                const cell = this.board[y][x];
                if (cell.visible[playerId]) {
                    visibleBoard[y][x] = {
                        units: cell.units.map(u => ({ player: u.player, count: u.count })),
                        visible: true
                    };
                } else {
                    visibleBoard[y][x] = {
                        units: [],
                        visible: false
                    };
                }
            }
        }
        
        return {
            playerId: playerId,
            playerName: player.name,
            currentTurn: this.currentTurn,
            myUnits: player.units,

            board: visibleBoard,
            diplomacyHistory: player.diplomacyHistory,  // История дипломатии игрока
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                units: p.units,
                isAlive: p.units > 0
            }))
        };
    }

    // Drawing functions
    draw() {
        if (!this.ctx) return;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.drawGrid();
        this.drawQuadrants();
        this.drawUnits();
        this.drawVisibility();
    }

    drawGrid() {
        this.ctx.strokeStyle = '#ddd';
        this.ctx.lineWidth = 1;
        
        // Draw resource cells backgrounds first
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const cell = this.board[y][x];
                if (cell.resourceCell) {
                    if (cell.depleted) {
                        // Depleted resource - gray background
                        this.ctx.fillStyle = '#f0f0f0';
                    } else {
                        // Available resource - golden background
                        this.ctx.fillStyle = '#fff3cd';
                    }
                    this.ctx.fillRect(x * this.cellSize, y * this.cellSize, this.cellSize, this.cellSize);
                }
            }
        }
        
        for (let i = 0; i <= 10; i++) {
            // Vertical lines
            this.ctx.beginPath();
            this.ctx.moveTo(i * this.cellSize, 0);
            this.ctx.lineTo(i * this.cellSize, 10 * this.cellSize);
            this.ctx.stroke();
            
            // Horizontal lines
            this.ctx.beginPath();
            this.ctx.moveTo(0, i * this.cellSize);
            this.ctx.lineTo(10 * this.cellSize, i * this.cellSize);
            this.ctx.stroke();
        }
        
        // Draw resource symbols
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const cell = this.board[y][x];
                if (cell.resourceCell) {
                    const centerX = x * this.cellSize + this.cellSize / 2;
                    const centerY = y * this.cellSize + this.cellSize / 2;
                    
                    this.ctx.font = '20px Arial';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    
                    if (cell.depleted) {
                        this.ctx.fillStyle = '#999';
                        this.ctx.fillText('🏜️', centerX, centerY);
                    } else {
                        this.ctx.fillStyle = '#ffa500';
                        this.ctx.fillText('💰', centerX, centerY);
                    }
                }
            }
        }
        
        // Thick middle lines
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 3;
        
        // Vertical middle line
        this.ctx.beginPath();
        this.ctx.moveTo(5 * this.cellSize, 0);
        this.ctx.lineTo(5 * this.cellSize, 10 * this.cellSize);
        this.ctx.stroke();
        
        // Horizontal middle line
        this.ctx.beginPath();
        this.ctx.moveTo(0, 5 * this.cellSize);
        this.ctx.lineTo(10 * this.cellSize, 5 * this.cellSize);
        this.ctx.stroke();
    }

    drawQuadrants() {
        this.players.forEach((player, index) => {
            const quad = player.quadrant;
            this.ctx.fillStyle = player.color + '20'; // 20 is alpha for transparency
            this.ctx.fillRect(
                quad.startX * this.cellSize,
                quad.startY * this.cellSize,
                (quad.endX - quad.startX + 1) * this.cellSize,
                (quad.endY - quad.startY + 1) * this.cellSize
            );
        });
    }

    drawUnits() {
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const cell = this.board[y][x];
                if (cell.units.length > 0) {
                    cell.units.forEach((unit, index) => {
                        const player = this.players.find(p => p.id === unit.player);
                        this.drawUnit(x, y, player, unit.count, index);
                    });
                }
            }
        }
    }

    drawUnit(x, y, player, count, stackIndex = 0) {
        const centerX = x * this.cellSize + this.cellSize / 2;
        const centerY = y * this.cellSize + this.cellSize / 2;
        const radius = 18;
        const offset = stackIndex * 8;
        
        // Unit circle
        this.ctx.fillStyle = player.color;
        this.ctx.beginPath();
        this.ctx.arc(centerX + offset, centerY + offset, radius, 0, 2 * Math.PI);
        this.ctx.fill();
        
        // Unit border
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        
        // Unit count
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(count.toString(), centerX + offset, centerY + offset);
    }

    drawVisibility() {
        // This could show fog of war effect for current player
        // For now, we'll show all units for spectator view
    }

    addLogEntry(message) {
        const logContainer = document.getElementById('log-container');
        if (logContainer) {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.innerHTML = `
                <span class="log-turn">[Ход ${this.currentTurn}]</span>
                <span class="log-message">${message}</span>
            `;
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    }

    addDiplomaticEntry(fromPlayer, toPlayer, message) {
        const diplomacyContainer = document.getElementById('diplomacy-container');
        if (diplomacyContainer) {
            const entry = document.createElement('div');
            entry.className = `diplomacy-entry ${fromPlayer.id}`;
            
            entry.innerHTML = `
                <div>
                    <span class="diplo-from">${fromPlayer.name}</span> 
                    → 
                    <span class="diplo-to">${toPlayer.name}</span>
                </div>
                <div class="diplo-message">${message}</div>
            `;
            diplomacyContainer.appendChild(entry);
            diplomacyContainer.scrollTop = diplomacyContainer.scrollHeight;
        }
    }

    // Game control methods
    startGame() {
        this.gameState = 'running';
        this.addLogEntry('🚀 Игра началась!');
    }

    pauseGame() {
        this.gameState = 'paused';
        this.addLogEntry('⏸️ Игра приостановлена');
    }

    resumeGame() {
        this.gameState = 'running';
        this.addLogEntry('▶️ Игра возобновлена');
    }

    resetGame() {
        this.currentTurn = 0;
        this.currentPlayerIndex = 0;
        this.gameState = 'waiting';
        
        // Reset players
        this.players.forEach(player => {
            player.units = 10;

            player.diplomacyHistory = [];  // Очистить историю дипломатии
        });
        
        // Reset board
        this.board = Array(10).fill().map((row, y) => Array(10).fill().map((cell, x) => ({
            units: [],
            visible: {}, // visibility for each player
            resourceCell: (x >= 4 && x <= 5 && y >= 4 && y <= 5), // Central resource cells
            depleted: false // Whether the resource has been claimed
        })));
        
        this.initializeBoard();
        this.draw();
        
        // Clear logs
        const logContainer = document.getElementById('log-container');
        const diplomacyContainer = document.getElementById('diplomacy-container');
        
        if (logContainer) {
            logContainer.innerHTML = '<div class="log-entry"><span class="log-turn">[Ход 0]</span><span class="log-message">Игра сброшена. Готово к новому запуску.</span></div>';
        }
        
        if (diplomacyContainer) {
            diplomacyContainer.innerHTML = '<div class="diplomacy-entry"><span class="diplo-info">Дипломатические сообщения будут появляться здесь...</span></div>';
        }
    }
}