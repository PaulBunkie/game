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
        
        const model = this.models[playerId];
        
        if (!model) {
            throw new Error(`Модель для игрока ${playerId} не найдена`);
        }

        const prompt = this.generatePrompt(gameState);
        
        try {
            console.log(`🔍 AI ${playerId}: Вызываю OpenRouter API для модели ${model}`);
            const response = await this.callOpenRouter(model, prompt);
            
            // Проверяем, что запрос все еще актуален
            if (this.activeRequestId !== requestId) {
                throw new Error(`Stale request: ${requestId} != ${this.activeRequestId}`);
            }
            
            console.log(`✅ AI ${playerId}: Получил ответ длиной ${response?.length || 0}`);
            
            // Check if response is empty or too short
            if (!response || response.trim().length < 10) {
                throw new Error('Пустой или слишком короткий ответ от AI');
            }
            
            const decision = this.parseAIResponse(response, gameState, requestId);
            
            // Check if we got a fallback decision and retry if so
            if (decision.reasoning === "Случайное решение из-за ошибки AI" && retryCount < 2) {
                console.log(`🔄 AI ${playerId}: Повторная попытка из-за fallback решения`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                return this.makeAIDecision(gameState, gameEngine, retryCount + 1, requestId);
            }
            
            return decision;
        } catch (error) {
            // Проверяем, что запрос все еще актуален
            if (this.activeRequestId !== requestId) {
                throw error; // Просто пробрасываем ошибку, она будет проигнорирована
            }
            
            console.error(`❌ Ошибка AI для ${playerId} (попытка ${retryCount + 1}):`, error.message);
            
            // Retry up to 2 times
            if (retryCount < 2) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                return this.makeAIDecision(gameState, gameEngine, retryCount + 1, requestId);
            }
            
            // Final fallback to random decision
            return this.generateRandomDecision(gameState);
        }
    }

    isHomeBase(x, y, playerId) {
        const homePositions = {
            'blue': { x: 0, y: 0 },
            'yellow': { x: 9, y: 0 },
            'green': { x: 9, y: 9 },
            'gray': { x: 0, y: 9 }
        };
        
        const home = homePositions[playerId];
        return home && x === home.x && y === home.y;
    }

    generatePrompt(gameState) {
        const { playerId, playerName, currentTurn, myUnits, canLie, board, players, diplomacyHistory } = gameState;
        
        // Create visible board representation
        let boardStr = "Текущее состояние карты (видимые вам клетки + центральные ресурсы всегда видны):\n";
        boardStr += "   0 1 2 3 4 5 6 7 8 9\n";
        
        for (let y = 0; y < 10; y++) {
            boardStr += y + " ";
            for (let x = 0; x < 10; x++) {
                const cell = board[y][x];
                if (cell.visible) {
                    if (cell.units.length === 0) {
                        // Check if this is a central resource cell
                        if (cell.resourceCell) {
                            if (cell.depleted) {
                                boardStr += "🏜️ "; // Depleted resource
                            } else {
                                boardStr += "💰 "; // Available resource
                            }
                        } else {
                            boardStr += " . ";
                        }
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
                    // Check if this is a central resource cell (always visible)
                    if (cell.resourceCell) {
                        if (cell.depleted) {
                            boardStr += "🏜️ "; // Depleted resource
                        } else {
                            boardStr += "💰 "; // Available resource
                        }
                    } else {
                        boardStr += " ? ";
                    }
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
                        // Highlight home base units (they might be bonus units)
                        const isHomeBase = this.isHomeBase(x, y, playerId);
                        const homeBaseMarker = isHomeBase ? " 🏠" : "";
                        myUnitsStr += `- Позиция (${x},${y}): ${myUnit.count} дивизий${homeBaseMarker}\n`;
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

        // Create central resources status (always visible to all players)
        let resourcesStr = "\n💰 СТАТУС ЦЕНТРАЛЬНЫХ РЕСУРСОВ:\n";
        const centralCells = [
            { x: 4, y: 4 }, { x: 4, y: 5 },
            { x: 5, y: 4 }, { x: 5, y: 5 }
        ];
        
        centralCells.forEach(({ x, y }) => {
            const cell = board[y][x];
            if (cell.resourceCell) {
                if (cell.depleted) {
                    resourcesStr += `- Клетка (${x},${y}): 🏜️ Ресурс исчерпан\n`;
                } else {
                    resourcesStr += `- Клетка (${x},${y}): 💰 Ресурс доступен (+1 дивизия)\n`;
                }
            }
        });

        // Create diplomacy history
        let diplomacyStr = "";
        if (diplomacyHistory && diplomacyHistory.length > 0) {
            diplomacyStr = "\n⚠️ ИСТОРИЯ ДИПЛОМАТИИ (последние 10 сообщений) - ОБЯЗАТЕЛЬНО ПРОЧТИ И ОТРЕАГИРУЙ:\n";
            diplomacyStr += "💀 ПОМНИ: Дипломатия - это тоже оружие!\n";
            
            // Show last 10 messages
            const recentMessages = diplomacyHistory.slice(-10);
            recentMessages.forEach(msg => {
                const direction = msg.type === 'sent' ? '→' : '⬅️';
                const otherPlayer = msg.type === 'sent' ? msg.to : msg.from;
                
                // Make incoming messages more visible
                const prefix = msg.type === 'received' ? '🔔 ВХОДЯЩЕЕ: ' : '';
                
                diplomacyStr += `${prefix}Ход ${msg.turn}: ${direction} ${otherPlayer}: "${msg.content}"\n`;
            });
        } else {
            diplomacyStr = "\n📭 ИСТОРИЯ ДИПЛОМАТИИ: Пока нет сообщений\n";
            diplomacyStr += "💀 НАЧИНАЙ ИГРУ: Используй дипломатию для своей победы!\n";
        }

        const prompt = `Ты играешь в пошаговую стратегическую игру как ${playerName}.

🎯 ЦЕЛЬ ИГРЫ: УНИЧТОЖИТЬ ВСЕХ СОПЕРНИКОВ! Остаться должен только один игрок - ТЫ!
⚔️ ЭТО ВОЙНА НА УНИЧТОЖЕНИЕ - победа любой ценой, но тактические союзы могут быть полезны!

ПРАВИЛА ИГРЫ:
- Карта 10x10, разделенная на 4 квадранта
- Каждая дивизия может передвинуться на 1 клетку (не обязательно)
- Допустимые направления: вверх (y-1), вниз (y+1), влево (x-1), вправо (x+1)
- Можешь передвинуть ВСЕ дивизии, НЕСКОЛЬКО или НИ ОДНОЙ
- 🏠 ВАЖНО: Используй ВСЕ доступные дивизии, включая те что в домашней базе!
- Можешь отправить ДО ДВУХ дипломатических сообщений разным противникам (остальные их не увидят)
- Ты можешь блефовать, а можешь быть честным - это твой выбор. Но помни, что союзник может превратиться в противника и наоборот. Доверяй, но проверяй!
- ВАЖНО: Получатель увидит твое сообщение только при СВОЕМ следующем ходе!
- Если на клетке есть враги при входе - происходит битва (разность количества дивизий)
- Видишь только клетки рядом со своими войсками (туман войны)
- 💰 ЦЕНТРАЛЬНЫЕ РЕСУРСЫ (4,4)-(5,5) ВСЕГДА ВИДНЫ всем игрокам!


РАСПОЛОЖЕНИЕ ИГРОКОВ НА КАРТЕ:
- 🔵 Синий (С): верхний левый квадрант (0,0)-(4,4)
- 🟡 Желтый (Ж): верхний правый квадрант (5,0)-(9,4)  
- 🟢 Зеленый (З): нижний правый квадрант (5,5)-(9,9)
- ⚪ Серый (Р): нижний левый квадрант (0,5)-(4,9)
Очередность ходов: Синий → Желтый → Зеленый → Серый

💰 ЦЕНТРАЛЬНЫЕ РЕСУРСЫ:
- Клетки (4,4), (4,5), (5,4), (5,5) содержат ценные ресурсы
- ПЕРВЫЙ кто войдет на ресурсную клетку получит +1 дивизию в свою базу
- После захвата ресурс ИСЧЕРПЫВАЕТСЯ и больше не дает бонусов
- Всего 4 бонусные дивизии на всю игру - спеши захватить!
- Бонусные дивизии появляются в твоем стартовом углу
- 🏠 УПРАВЛЕНИЕ БАЗОЙ: Бонусные дивизии появляются в твоей домашней базе. Не забывай их использовать и перемещать!
- ⚔️ КАЖДАЯ ДИВИЗИЯ ВАЖНА: используй все ресурсы для уничтожения врагов!

ТЕКУЩАЯ СИТУАЦИЯ:
- Ход: ${currentTurn}
- Твои дивизии: ${myUnits}

${myUnitsStr}

${boardStr}

${playersStr}

${resourcesStr}

${diplomacyStr}

ВАЖНО: Отвечай ТОЛЬКО JSON без лишнего текста. Вот примеры:

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
      "content": "Предлагаю союз против Синего! Сколько у тебя войск и на каких они клетках?"
    },
    {
      "to": "yellow", 
      "content": "Готов к сотрудничеству? Серый становится слишком сильным, я помогу тебе и открою фронт на востоке"
    }
  ],
  "reasoning": "Объяснение твоей стратегии"
}
\`\`\`

ИЛИ пропуск хода:
\`\`\`json
{
  "moves": [],
  "diplomacy": [
    {
      "to": "blue",
      "content": "Пропускаю ход, но готов к переговорам"
    }
  ],
  "reasoning": "Решил не двигаться в этот ход"
}
\`\`\`

ВНИМАНИЕ: Используй ТОЧНЫЕ координаты fromX/fromY из секции "ТВОИ ВОЙСКА"!

🏠 ПРОВЕРЬ ДОМАШНУЮ БАЗУ: Не забывай про дивизии в стартовом углу - они могут быть бонусными!
💀 ЦЕЛЬ: УНИЧТОЖИТЬ ВСЕХ! Каждая дивизия должна работать на победу!

ТРЕБОВАНИЯ:
- В moves можешь указать ходы или пустой массив [] (пропуск хода)
        - В diplomacy можешь отправить до 2 сообщений разным игрокам или пустой массив []
        - Каждый элемент массива: {"to": "blue/yellow/green/gray", "content": "текст"}  
        - 💀 ДИПЛОМАТИЯ = ОРУЖИЕ: используй сообщения для обмана, дезинформации и манипуляций!
        - Можешь задавать ВОПРОСЫ и делать заявления - решай сам кому верить!
        - Помни: отправленное сообщение получатель прочтет только при СВОЕМ ходе!
- ⚡ ВНИМАТЕЛЬНО ЧИТАЙ ВХОДЯЩИЕ СООБЩЕНИЯ (←) и обязательно реагируй на них!
- 🏠 ВНИМАТЕЛЬНО СЛЕДИ ЗА ДИВИЗИЯМИ В ДОМАШНЕЙ БАЗЕ - они могут быть бонусными!
- 💀 БУДЬ БЕСПОЩАДЕН: используй дипломатию для обмана, блеф для дезинформации, разведку для поиска слабостей
- ⚔️ АТАКУЙ СЛАБЫХ: ищи возможности уничтожить ослабленных противников
- 🎭 ЛЖИ И ОБМАНЫВАЙ: дипломатия - это оружие, а не дружба!
- 🏆 ПОМНИ: победитель только один - это должен быть ТЫ!

💀 ФИНАЛЬНОЕ НАПОМИНАНИЕ: Твоя цель - УНИЧТОЖИТЬ ВСЕХ СОПЕРНИКОВ! Будь беспощаден, используй любые средства для победы!

ОТВЕЧАЙ ТОЛЬКО JSON В УКАЗАННОМ ФОРМАТЕ!`;

        return prompt;
    }

    async callOpenRouter(model, prompt) {
        console.log(`📡 OpenRouter: Отправляю запрос к модели ${model}`);
        console.log(`🔑 API Key: ${this.getApiKey() ? 'Установлен' : 'НЕ УСТАНОВЛЕН'}`);
        
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

        console.log(`📡 OpenRouter: HTTP статус ${response.status}`);

        if (!response.ok) {
            const error = await response.text();
            console.error(`❌ HTTP Error: ${response.status} - ${error}`);
            
            // Handle rate limiting specifically
            if (response.status === 429) {
                console.log(`⏳ Rate limit hit, waiting 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                throw new Error('Rate limit exceeded, retry after delay');
            }
            
            throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        console.log(`📡 OpenRouter: Успешный ответ от API`);
        return data.choices[0].message.content;
    }

    parseAIResponse(response, gameState, requestId = 'unknown') {
        try {
            // Try multiple JSON extraction methods
            let jsonStr = null;
            
            // Method 1: Look for JSON block with code markers
            const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
            if (codeBlockMatch) {
                jsonStr = codeBlockMatch[1];
                
                // Quick check if JSON looks truncated
                if (!jsonStr.includes('"reasoning"') || !jsonStr.endsWith('}')) {
                    jsonStr = null; // Force try other methods
                }
            } else {
                // Method 2: Find the first complete JSON object
                const jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[0];
                } else {
                    // Method 3: Try to find any curly braces content
                    const fallbackMatch = response.match(/\{[\s\S]*\}/);
                    if (fallbackMatch) {
                        jsonStr = fallbackMatch[0];
                    }
                }
            }
            
            if (!jsonStr) {
                throw new Error('No JSON found in response');
            }

            let decision = JSON.parse(jsonStr);
            
            // Check if response was truncated (missing required structure)
            if (!decision.moves || !decision.reasoning) {
                throw new Error('Truncated response: missing required fields (moves, reasoning)');
            }
            
            // Fix common AI mistakes
            if (decision.diplomаcy && !decision.diplomacy) {
                // Fix Cyrillic 'а' instead of Latin 'a' in diplomacy
                decision.diplomacy = decision.diplomаcy;
                delete decision.diplomаcy;
            }
            
            if (decision.diplоматия && !decision.diplomacy) {
                // Fix Russian word "дипломатия"
                decision.diplomacy = decision.diplоматия;
                delete decision.diplоматия;
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

            // Validate diplomacy if present (now array of up to 2 messages, no isLie needed)
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

            return decision;
        } catch (error) {
            console.error(`❌ Error parsing AI response for ${gameState.playerId}:`, error.message);
            
            // Return fallback decision
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
        
        try {
            const decision = await this.makeAIDecision(request.gameState, request.gameEngine);
            request.resolve(decision);
        } catch (error) {
            request.reject(error);
        }
        
        // Process next request immediately
        this.processQueue();
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