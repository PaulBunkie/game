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
                lies: 0,
                maxLies: 1,
                lastLiesTurn: -10,
                startPosition: { x: 0, y: 0 },
                quadrant: { startX: 0, startY: 0, endX: 4, endY: 4 },
                diplomacyHistory: []
            },
            {
                id: 'yellow',
                name: 'Желтый',
                color: '#ffd700',
                units: 10,
                lies: 0,
                maxLies: 1,
                lastLiesTurn: -10,
                startPosition: { x: 9, y: 0 },
                quadrant: { startX: 5, startY: 0, endX: 9, endY: 4 },
                diplomacyHistory: []
            },
            {
                id: 'gray',
                name: 'Серый',
                color: '#6c757d',
                units: 10,
                lies: 0,
                maxLies: 1,
                lastLiesTurn: -10,
                startPosition: { x: 0, y: 9 },
                quadrant: { startX: 0, startY: 5, endX: 4, endY: 9 },
                diplomacyHistory: []
            },
            {
                id: 'green',
                name: 'Зеленый',
                color: '#34a853',
                units: 10,
                lies: 0,
                maxLies: 1,
                lastLiesTurn: -10,
                startPosition: { x: 9, y: 9 },
                quadrant: { startX: 5, startY: 5, endX: 9, endY: 9 },
                diplomacyHistory: []
            }
        ];

        // Game board: 10x10 grid
        this.board = Array(10).fill().map(() => Array(10).fill().map(() => ({
            units: [],
            visible: {} // visibility for each player
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

    canPlayerLie(playerId) {
        const player = this.players.find(p => p.id === playerId);
        return player.lies < player.maxLies && (this.currentTurn - player.lastLiesTurn) >= 10;
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
        
        if (validMoves.length === 0) {
            console.log(`❌ No valid moves for ${playerId}!`);
            return false;
        }

        console.log(`⚡ Executing moves for ${playerId}`);
        this.executeMoves(validMoves, playerId);
        
        if (diplomaticMessage) {
            console.log(`💬 Processing diplomacy for ${playerId}:`, diplomaticMessage);
            this.processDiplomaticMessage(diplomaticMessage);
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
        
        // Fact-check the message content
        const factCheckResult = this.factCheckMessage(message.content, from.id, to.id);
        const actuallyLied = factCheckResult.isLie;
        const claimedLie = message.isLie || false;
        
        console.log(`🔍 Fact-checking "${message.content}"`);
        console.log(`📊 Claimed lie: ${claimedLie}, Actually lied: ${actuallyLied}`);
        if (factCheckResult.detectedLies.length > 0) {
            console.log(`🚨 Detected lies: ${factCheckResult.detectedLies.join(', ')}`);
        }
        
        // Count actual lies, not claimed lies
        if (actuallyLied && this.canPlayerLie(from.id)) {
            from.lies++;
            from.lastLiesTurn = this.currentTurn;
        }
        
        // Create diplomatic message record with fact-check results
        const diplomaticRecord = {
            turn: this.currentTurn,
            from: from.id,
            to: to.id,
            content: message.content,
            claimedLie: claimedLie,           // Что ИИ заявил
            actuallyLied: actuallyLied,      // Что мы проверили
            detectedLies: factCheckResult.detectedLies,  // Конкретные обманы
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
        
        this.addDiplomaticEntry(from, to, message.content, actuallyLied, factCheckResult.detectedLies);
    }

    // Fact-check diplomatic messages
    factCheckMessage(messageText, senderId, receiverId) {
        const detectedLies = [];
        const sender = this.players.find(p => p.id === senderId);
        const receiver = this.players.find(p => p.id === receiverId);
        
        const lowerText = messageText.toLowerCase();
        
        // Check 1: Claims about own unit count
        const unitClaimRegex = /(?:у меня|имею|есть)\s+(\d+)\s+(?:дивизий|дивизии|войск|юнитов)/i;
        const unitMatch = messageText.match(unitClaimRegex);
        if (unitMatch) {
            const claimedUnits = parseInt(unitMatch[1]);
            const actualUnits = sender.units;
            if (claimedUnits !== actualUnits) {
                detectedLies.push(`Заявил ${claimedUnits} дивизий, а имеет ${actualUnits}`);
            }
        }

        // Check 2: Claims about positions (if visible to receiver)
        const positionRegex = /(?:на|в)\s*\(?(\d),?\s*(\d)\)?\s*(?:есть|находятся|стоят)/i;
        const posMatch = messageText.match(positionRegex);
        if (posMatch) {
            const x = parseInt(posMatch[1]);
            const y = parseInt(posMatch[2]);
            
            if (x >= 0 && x < 10 && y >= 0 && y < 10) {
                const cell = this.board[y][x];
                // Only check if receiver can see this cell
                if (cell.visible[receiverId]) {
                    const hasUnits = cell.units.length > 0;
                    const claimsUnitsExist = lowerText.includes('есть') || lowerText.includes('находятся');
                    
                    if (claimsUnitsExist && !hasUnits) {
                        detectedLies.push(`Заявил что на (${x},${y}) есть войска, а там пусто`);
                    } else if (!claimsUnitsExist && hasUnits) {
                        detectedLies.push(`Заявил что на (${x},${y}) пусто, а там есть войска`);
                    }
                }
            }
        }

        // Check 3: Claims about being eliminated/alive
        if (lowerText.includes('уничтожен') || lowerText.includes('мертв') || lowerText.includes('проигра')) {
            if (sender.units > 0) {
                detectedLies.push(`Заявил что уничтожен, но имеет ${sender.units} дивизий`);
            }
        }

        // Check 4: Extreme unit count claims (obviously false)
        const largeNumberRegex = /(\d{2,})\s*(?:дивизий|дивизии|войск)/i;
        const largeMatch = messageText.match(largeNumberRegex);
        if (largeMatch) {
            const claimedNumber = parseInt(largeMatch[1]);
            if (claimedNumber > 50) { // Impossible in this game
                detectedLies.push(`Заявил ${claimedNumber} дивизий - физически невозможно`);
            }
        }

        const isLie = detectedLies.length > 0;
        
        return {
            isLie: isLie,
            detectedLies: detectedLies,
            checkedPatterns: ['unit_count', 'positions', 'status', 'impossible_claims']
        };
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
            myLies: player.lies,
            canLie: this.canPlayerLie(playerId),
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

    addDiplomaticEntry(fromPlayer, toPlayer, message, isLie = false, detectedLies = []) {
        const diplomacyContainer = document.getElementById('diplomacy-container');
        if (diplomacyContainer) {
            const entry = document.createElement('div');
            entry.className = `diplomacy-entry ${fromPlayer.id}`;
            
            let lieIndicator = '';
            if (isLie) {
                lieIndicator = ' <span style="color: red; font-weight: bold;">[ЛОЖЬ ОБНАРУЖЕНА]</span>';
                if (detectedLies.length > 0) {
                    lieIndicator += `<br><small style="color: #dc3545;">📋 ${detectedLies.join('; ')}</small>`;
                }
            }
            
            entry.innerHTML = `
                <div>
                    <span class="diplo-from">${fromPlayer.name}</span> 
                    → 
                    <span class="diplo-to">${toPlayer.name}</span>
                    ${lieIndicator}
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
            player.lies = 0;
            player.lastLiesTurn = -10;
            player.diplomacyHistory = [];  // Очистить историю дипломатии
        });
        
        // Reset board
        this.board = Array(10).fill().map(() => Array(10).fill().map(() => ({
            units: [],
            visible: {}
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