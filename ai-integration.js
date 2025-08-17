class AIIntegration {
    constructor() {
        this.apiKey = '';
        this.baseUrl = 'https://openrouter.ai/api/v1';
        this.models = {
            'blue': 'google/gemma-3-27b-it:free',
            'yellow': 'meta-llama/llama-3.3-70b-instruct:free',
            'gray': 'mistralai/mistral-small-3.2-24b-instruct:free',
            'green': 'qwen/qwen-2.5-72b-instruct:free'
        };
        this.requestQueue = [];
        this.isProcessing = false;
        this.activeRequestId = null; // ID текущего активного запроса
        this.requestCounter = 0; // Счетчик для генерации уникальных ID
    }

    setApiKey(apiKey) {
        this.apiKey = apiKey;
        localStorage.setItem('openrouter_api_key', apiKey);
    }

    getApiKey() {
        if (!this.apiKey) {
            this.apiKey = localStorage.getItem('openrouter_api_key') || '';
        }
        return this.apiKey;
    }

    async makeAIDecision(gameState, gameEngine, retryCount = 0, requestId = null) {
        if (!this.getApiKey()) {
            throw new Error('API ключ не настроен');
        }

        const playerId = gameState.playerId;
        
        // Генерируем уникальный ID запроса если его нет
        if (!requestId) {
            requestId = `${playerId}-${++this.requestCounter}`;
            this.activeRequestId = requestId;
        }
        
        console.log(`🔍 makeAIDecision called for playerId: ${playerId}, requestId: ${requestId}`);
        
        const model = this.models[playerId];
        
        if (!model) {
            throw new Error(`Модель для игрока ${playerId} не найдена`);
        }

        const prompt = this.generatePrompt(gameState);
        
        try {
            const response = await this.callOpenRouter(model, prompt);
            
            // Проверяем, что запрос все еще актуален
            if (this.activeRequestId !== requestId) {
                console.log(`🚫 Ignoring stale response for ${playerId} (requestId: ${requestId}, active: ${this.activeRequestId})`);
                throw new Error(`Stale request: ${requestId} != ${this.activeRequestId}`);
            }
            
            // Check if response is empty or too short
            if (!response || response.trim().length < 10) {
                throw new Error('Пустой или слишком короткий ответ от AI');
            }
            
            const decision = this.parseAIResponse(response, gameState, requestId);
            
            // Check if we got a fallback decision and retry if so
            if (decision.reasoning === "Случайное решение из-за ошибки AI" && retryCount < 2) {
                console.log(`🔄 Retry attempt ${retryCount + 1} for ${playerId}`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                return this.makeAIDecision(gameState, gameEngine, retryCount + 1, requestId);
            }
            
            return decision;
        } catch (error) {
            // Проверяем, что запрос все еще актуален
            if (this.activeRequestId !== requestId) {
                console.log(`🚫 Ignoring stale error for ${playerId} (requestId: ${requestId}, active: ${this.activeRequestId})`);
                throw error; // Просто пробрасываем ошибку, она будет проигнорирована
            }
            
            console.error(`❌ Ошибка AI для ${playerId} (попытка ${retryCount + 1}):`, error);
            
            // Retry up to 2 times
            if (retryCount < 2) {
                console.log(`🔄 Retry attempt ${retryCount + 1} for ${playerId}`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                return this.makeAIDecision(gameState, gameEngine, retryCount + 1, requestId);
            }
            
            // Final fallback to random decision
            console.log(`🎲 Final fallback for ${playerId} after ${retryCount + 1} attempts`);
            return this.generateRandomDecision(gameState);
        }
    }

    generatePrompt(gameState) {
        const { playerId, playerName, currentTurn, myUnits, canLie, board, players, diplomacyHistory } = gameState;
        
        // Create visible board representation
        let boardStr = "Текущее состояние карты (только видимые вам клетки):\n";
        boardStr += "   0 1 2 3 4 5 6 7 8 9\n";
        
        for (let y = 0; y < 10; y++) {
            boardStr += y + " ";
            for (let x = 0; x < 10; x++) {
                const cell = board[y][x];
                if (cell.visible) {
                    if (cell.units.length === 0) {
                        boardStr += " . ";
                    } else {
                        const unit = cell.units[0]; // Show first unit
                        const playerSymbol = {
                            'blue': 'С',
                            'yellow': 'Ж', 
                            'gray': 'Р',
                            'green': 'З'
                        }[unit.player] || '?';
                        boardStr += unit.count < 10 ? ` ${playerSymbol}${unit.count}` : `${playerSymbol}${unit.count}`;
                    }
                } else {
                    boardStr += " ? ";
                }
            }
            boardStr += "\n";
        }

        // Create my units positions
        let myUnitsStr = "ТВОИ ВОЙСКА:\n";
        let foundMyUnits = [];
        
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const cell = board[y][x];
                if (cell.visible && cell.units.length > 0) {
                    const myUnit = cell.units.find(u => u.player === playerId);
                    if (myUnit && myUnit.count > 0) {
                        foundMyUnits.push(`(${x},${y}): ${myUnit.count} дивизий`);
                        myUnitsStr += `- Позиция (${x},${y}): ${myUnit.count} дивизий\n`;
                    }
                }
            }
        }
        
        if (foundMyUnits.length === 0) {
            myUnitsStr += "- ОШИБКА: Не найдены ваши войска!\n";
        }
        
        // Create players status
        let playersStr = "Статус игроков:\n";
        players.forEach(p => {
            playersStr += `- ${p.name}: ${p.units} дивизий ${p.isAlive ? '(жив)' : '(мертв)'}\n`;
        });

        // Create diplomacy history
        let diplomacyStr = "";
        if (diplomacyHistory && diplomacyHistory.length > 0) {
            diplomacyStr = "\n⚠️ ИСТОРИЯ ДИПЛОМАТИИ (последние 10 сообщений) - ОБЯЗАТЕЛЬНО ПРОЧТИ И ОТРЕАГИРУЙ:\n";
            
            // Show last 10 messages
            const recentMessages = diplomacyHistory.slice(-10);
            recentMessages.forEach(msg => {
                const direction = msg.type === 'sent' ? '→' : '⬅️';
                const otherPlayer = msg.type === 'sent' ? msg.to : msg.from;
                
                // Show fact-check results instead of claimed lies
                let lieIndicator = '';
                if (msg.actuallyLied) {
                    lieIndicator = ' [ЛОЖЬ ОБНАРУЖЕНА]';
                } else if (msg.claimedLie && !msg.actuallyLied) {
                    lieIndicator = ' [ЗАЯВИЛ ЛОЖЬ, НО ГОВОРИЛ ПРАВДУ]';
                }
                
                // Make incoming messages more visible
                const prefix = msg.type === 'received' ? '🔔 ВХОДЯЩЕЕ: ' : '';
                
                diplomacyStr += `${prefix}Ход ${msg.turn}: ${direction} ${otherPlayer}: "${msg.content}"${lieIndicator}\n`;
            });
        } else {
            diplomacyStr = "\n📭 ИСТОРИЯ ДИПЛОМАТИИ: Пока нет сообщений\n";
        }

        const prompt = `Ты играешь в пошаговую стратегическую игру как ${playerName}.

ПРАВИЛА ИГРЫ:
- Карта 10x10, разделенная на 4 квадранта
- За ход ОБЯЗАТЕЛЬНО нужно передвинуть хотя бы 1 дивизию на 1 клетку (ТОЛЬКО по горизонтали или вертикали, НЕ по диагонали!)
- Допустимые направления: вверх (y-1), вниз (y+1), влево (x-1), вправо (x+1)
- Можешь отправить ДО ДВУХ дипломатических сообщений разным противникам (остальные их не увидят)
- ВАЖНО: Получатель увидит твое сообщение только при СВОЕМ следующем ходе!
- Если на клетке есть враги при входе - происходит бой (разность количества дивизий)
- Видишь только клетки рядом со своими войсками (туман войны)
- Можешь солгать, но только 1 раз за 10 ходов

РАСПОЛОЖЕНИЕ ИГРОКОВ НА КАРТЕ:
- 🔵 Синий (С): верхний левый квадрант (0,0)-(4,4)
- 🟡 Желтый (Ж): верхний правый квадрант (5,0)-(9,4)  
- 🟢 Зеленый (З): нижний правый квадрант (5,5)-(9,9)
- ⚪ Серый (Р): нижний левый квадрант (0,5)-(4,9)
Очередность ходов: Синий → Желтый → Зеленый → Серый

ТЕКУЩАЯ СИТУАЦИЯ:
- Ход: ${currentTurn}
- Твои дивизии: ${myUnits}
- Можешь солгать: ${canLie ? 'Да' : 'Нет'}

${myUnitsStr}

${boardStr}

${playersStr}

${diplomacyStr}

ВАЖНО: Отвечай ТОЛЬКО JSON без лишнего текста. Вот пример:

\`\`\`json
{
  "moves": [
    {
      "fromX": 0,
      "fromY": 0, 
      "toX": 1,
      "toY": 0,
      "unitCount": 3
    }
  ],
  "diplomacy": [
    {
      "to": "gray",
      "content": "Предлагаю союз против Синего!",
      "isLie": false
    },
    {
      "to": "yellow", 
      "content": "Внимание! Серый планирует атаку на твой фланг!",
      "isLie": false
    }
  ],
  "reasoning": "Объяснение твоей стратегии"
}
\`\`\`

ВНИМАНИЕ: Используй ТОЧНЫЕ координаты fromX/fromY из секции "ТВОИ ВОЙСКА"!

ТРЕБОВАНИЯ:
- В moves ОБЯЗАТЕЛЬНО должен быть хотя бы один ход
        - В diplomacy можешь отправить до 2 сообщений разным игрокам или пустой массив []
        - Каждый элемент массива: {"to": "blue/yellow/green/gray", "content": "текст", "isLie": true/false}
        - Помни: отправленное сообщение получатель прочтет только при СВОЕМ ходе!
- ⚡ ВНИМАТЕЛЬНО ЧИТАЙ ВХОДЯЩИЕ СООБЩЕНИЯ (←) и обязательно реагируй на них!
- Будь умным стратегом: используй дипломатию, ложь (если можешь), разведку

ОТВЕЧАЙ ТОЛЬКО JSON В УКАЗАННОМ ФОРМАТЕ!`;

        return prompt;
    }

    async callOpenRouter(model, prompt) {
        console.log(`🌐 Calling OpenRouter for model: ${model}`);
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getApiKey()}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'AI Strategic Battle'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.3,  // Lower temperature for more consistent responses
                max_tokens: 1500,  // More tokens to ensure complete responses
                top_p: 0.9
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    }

    parseAIResponse(response, gameState, requestId = 'unknown') {
        console.log(`🤖 AI Raw Response for ${gameState.playerId} (requestId: ${requestId}):`, response);
        console.log(`📏 Response length: ${response.length} characters`);
        
        try {
            // Try multiple JSON extraction methods
            let jsonStr = null;
            
            // Method 1: Look for JSON block with code markers
            const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1];
                console.log('📦 Found JSON in code block:', jsonStr);
                
                // Quick check if JSON looks truncated
                if (!jsonStr.includes('"reasoning"') || !jsonStr.endsWith('}')) {
                    console.log(`⚠️ JSON appears truncated (length: ${jsonStr.length}, ends with: "${jsonStr.slice(-10)}"), trying other methods...`);
                    jsonStr = null; // Force try other methods
                }
            } else {
                // Method 2: Find the first complete JSON object
                const jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[0];
                    console.log('📦 Found JSON object:', jsonStr);
                } else {
                    // Method 3: Try to find any curly braces content
                    const fallbackMatch = response.match(/\{[\s\S]*\}/);
                    if (fallbackMatch) {
                        jsonStr = fallbackMatch[0];
                        console.log('📦 Found fallback JSON:', jsonStr);
                    }
                }
            }
            
            if (!jsonStr) {
                throw new Error('No JSON found in response');
            }

            let decision = JSON.parse(jsonStr);
            console.log('✅ Parsed decision:', decision);
            
            // Check if response was truncated (missing required structure)
            if (!decision.moves || !decision.reasoning) {
                throw new Error('Truncated response: missing required fields (moves, reasoning)');
            }
            
            // Fix common AI mistakes
            if (decision.diplomаcy && !decision.diplomacy) {
                // Fix Cyrillic 'а' instead of Latin 'a' in diplomacy
                decision.diplomacy = decision.diplomаcy;
                delete decision.diplomаcy;
                console.log('🔧 Fixed diplomаcy -> diplomacy');
            }
            
            if (decision.diplоматия && !decision.diplomacy) {
                // Fix Russian word "дипломатия"
                decision.diplomacy = decision.diplоматия;
                delete decision.diplоматия;
                console.log('🔧 Fixed diplоматия -> diplomacy');
            }
            
            // Validate decision structure
            if (!decision.moves || !Array.isArray(decision.moves) || decision.moves.length === 0) {
                throw new Error('Invalid moves in AI response');
            }

            // Validate moves
            decision.moves.forEach(move => {
                if (typeof move.fromX !== 'number' || typeof move.fromY !== 'number' ||
                    typeof move.toX !== 'number' || typeof move.toY !== 'number' ||
                    typeof move.unitCount !== 'number') {
                    throw new Error('Invalid move format');
                }
            });

            // Validate diplomacy if present (now array of up to 2 messages)
            if (decision.diplomacy && Array.isArray(decision.diplomacy)) {
                // Filter out invalid messages and limit to 2
                decision.diplomacy = decision.diplomacy.filter(msg => 
                    msg && typeof msg.to === 'string' && typeof msg.content === 'string'
                ).slice(0, 2); // Max 2 messages
                
                if (decision.diplomacy.length === 0) {
                    decision.diplomacy = null;
                }
            } else if (decision.diplomacy && typeof decision.diplomacy.to === 'string') {
                // Legacy support: convert single diplomacy object to array
                decision.diplomacy = [decision.diplomacy];
            } else {
                decision.diplomacy = null;
            }

            console.log('✅ Valid decision for', gameState.playerId, decision);
            return decision;
        } catch (error) {
            console.error(`❌ Error parsing AI response for ${gameState.playerId}:`, error);
            console.log('🔍 Raw response was:', response);
            
            // Return fallback decision
            console.log('🎲 Using fallback random decision');
            return this.generateRandomDecision(gameState);
        }
    }

    generateRandomDecision(gameState) {
        const { board, playerId } = gameState;
        const moves = [];
        
        // Find player's units
        for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 10; x++) {
                const cell = board[y][x];
                if (cell.visible && cell.units.length > 0) {
                    const playerUnit = cell.units.find(u => u.player === playerId);
                    if (playerUnit && playerUnit.count > 0) {
                        // Try to make a random valid move
                        const directions = [
                            { dx: 0, dy: -1 }, { dx: 1, dy: 0 },
                            { dx: 0, dy: 1 }, { dx: -1, dy: 0 }
                        ];
                        
                        for (const dir of directions) {
                            const newX = x + dir.dx;
                            const newY = y + dir.dy;
                            
                            if (newX >= 0 && newX < 10 && newY >= 0 && newY < 10) {
                                moves.push({
                                    fromX: x,
                                    fromY: y,
                                    toX: newX,
                                    toY: newY,
                                    unitCount: Math.min(1, playerUnit.count)
                                });
                                break;
                            }
                        }
                        
                        if (moves.length > 0) break;
                    }
                }
            }
            if (moves.length > 0) break;
        }
        
        // If no valid moves found, this is a problem
        if (moves.length === 0) {
            console.error('No valid moves found for fallback decision');
            // Return a default move (this shouldn't happen in normal gameplay)
            moves.push({
                fromX: 0, fromY: 0, toX: 1, toY: 0, unitCount: 1
            });
        }
        
        return {
            moves: moves,
            diplomacy: [], // Empty array for no diplomacy
            reasoning: "Случайное решение из-за ошибки AI"
        };
    }

    // Queue system for AI requests to avoid rate limits
    async queueRequest(gameState, gameEngine) {
        // Clear queue if it's a different player to avoid conflicts
        const currentPlayerId = gameState.playerId;
        if (this.requestQueue.length > 0) {
            const queuedPlayerId = this.requestQueue[0].gameState.playerId;
            if (queuedPlayerId !== currentPlayerId) {
                console.log(`🧹 Clearing queue: switching from ${queuedPlayerId} to ${currentPlayerId}`);
                // Reject all pending requests from different player
                this.requestQueue.forEach(request => {
                    request.reject(new Error(`Request cancelled: player switch from ${queuedPlayerId} to ${currentPlayerId}`));
                });
                this.requestQueue = [];
                this.isProcessing = false;
                // Сбрасываем активный запрос для предотвращения обработки устаревших ответов
                this.activeRequestId = null;
            }
        }
        
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                gameState,
                gameEngine,
                resolve,
                reject
            });
            
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.requestQueue.length === 0) {
            this.isProcessing = false;
            return;
        }
        
        this.isProcessing = true;
        const request = this.requestQueue.shift();
        
        console.log(`🏭 Processing queue request for player: ${request.gameState.playerId}`);
        
        try {
            const decision = await this.makeAIDecision(request.gameState, request.gameEngine);
            request.resolve(decision);
        } catch (error) {
            request.reject(error);
        }
        
        // Add delay between requests to respect rate limits
        setTimeout(() => {
            this.processQueue();
        }, 1000); // 1 second delay
    }

    // Test API connection
    async testConnection() {
        if (!this.getApiKey()) {
            throw new Error('API ключ не настроен');
        }

        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.getApiKey()}`
                }
            });

            if (!response.ok) {
                throw new Error(`API недоступен: ${response.status}`);
            }

            return true;
        } catch (error) {
            throw new Error(`Ошибка подключения к API: ${error.message}`);
        }
    }

    // Get model status
    async getModelStatus() {
        const modelStatus = {};
        
        for (const [playerId, modelName] of Object.entries(this.models)) {
            try {
                const response = await fetch(`${this.baseUrl}/models/${modelName}`, {
                    headers: {
                        'Authorization': `Bearer ${this.getApiKey()}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    modelStatus[playerId] = {
                        available: true,
                        model: modelName,
                        info: data
                    };
                } else {
                    modelStatus[playerId] = {
                        available: false,
                        model: modelName,
                        error: `HTTP ${response.status}`
                    };
                }
            } catch (error) {
                modelStatus[playerId] = {
                    available: false,
                    model: modelName,
                    error: error.message
                };
            }
        }
        
        return modelStatus;
    }
}