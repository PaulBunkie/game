class AIIntegration {
    constructor() {
        this.apiKey = '';
        this.baseUrl = 'https://openrouter.ai/api/v1';
        this.models = {
            'blue': 'google/gemini-2.0-flash-001', //'google/gemma-3-27b-it:free',
            'yellow': 'meta-llama/llama-4-scout', //'meta-llama/llama-3.3-70b-instruct:free',
            'gray': 'mistralai/mistral-nemo', //'mistralai/mistral-small-3.2-24b-instruct:free',
            'green': 'qwen/qwen3-30b-a3b', //'qwen/qwen-2.5-72b-instruct:free'
        };
        
        // Commentator model - sees everything and provides colorful commentary
        this.commentatorModel = 'google/gemini-2.0-flash-001'; // Good for analysis and commentary
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

        const { systemPrompt, userPrompt } = this.generatePrompt({
            ...gameState,
            playerId,
            playerName: this.getPlayerName(playerId)
        });
        
        try {
            const response = await this.callOpenRouter(model, systemPrompt, userPrompt);
            
            // Проверяем, что запрос все еще актуален
            if (this.activeRequestId !== requestId) {
                throw new Error(`Stale request: ${requestId} != ${this.activeRequestId}`);
            }
            
            // Check if response is empty or too short
            if (!response || response.trim().length < 10) {
                throw new Error('Пустой или слишком короткий ответ от AI');
            }
            
            const decision = this.parseAIResponse(response, gameState, requestId);
            
            // Check if we got a fallback decision and retry if so
            if (decision.reasoning === "Случайное решение из-за ошибки AI" && retryCount < 2) {
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

    getPlayerName(playerId) {
        const names = {
            'blue': 'Синий',
            'yellow': 'Желтый',
            'green': 'Зеленый',
            'gray': 'Серый'
        };
        return names[playerId] || 'Неизвестный';
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
        const { playerId, playerName, currentTurn, board, players, diplomacyHistory } = gameState;
        
        // Create visible board representation
        let boardStr = "Текущее состояние карты (видимые вам клетки + центральные ресурсы всегда видны):\n";
        boardStr += "   0 1 2 3 4 5 6 7 8 9\n";
        boardStr += "🏰 БАЗЫ: 🔵(0,0) 🟡(9,0) 🟢(9,9) ⚪(0,9) - захваченные помечены 🚫\n";
        
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
                            // Check if this is a captured enemy base
                            if (cell.baseCapture) {
                                boardStr += "🚫 "; // Captured base
                            } else {
                                boardStr += " . ";
                            }
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

        // System message with game rules and format requirements
        const systemPrompt = `Ты играешь в пошаговую стратегическую игру как ${playerName}.

🎯 ЦЕЛЬ ИГРЫ
УНИЧТОЖИТЬ ВСЕХ СОПЕРНИКОВ! Остаться должен только один игрок - ТЫ!

🗺️ КАРТА И ЗОНЫ
Карта размером 10x10 клеток.
Разделена на 4 квадранта:
🔵 Синий (С): Верхний левый квадрант (0,0)-(4,4). База: (0,0)
🟡 Желтый (Ж): Верхний правый квадрант (5,0)-(9,4). База: (9,0)
🟢 Зеленый (З): Нижний правый квадрант (5,5)-(9,9). База: (9,9)
⚪ Серый (Р): Нижний левый квадрант (0,5)-(4,9). База: (0,9)

ЦЕНТРАЛЬНЫЕ РЕСУРСЫ: Клетки (4,4), (4,5), (5,4), (5,5). Каждая содержит ценный ресурс (+1 дивизия при первом захвате).

⚔️ МЕХАНИКА ИГРЫ
НАЧАЛО:
Каждый игрок начинает с 10 дивизий, расположенных в его базовой клетке (🔵(0,0), 🟡(9,0), 🟢(9,9), ⚪(0,9)).
Очередность ходов: 🔵 Синий → 🟡 Желтый → 🟢 Зеленый → ⚪ Серый.

ХОД ИГРОКА (Действия):

ПЕРЕМЕЩЕНИЕ ВОЙСК:
Каждая дивизия может передвинуться на 1 клетку по горизонтали или вертикали (диагональ запрещена).
Движение НЕ ОБЯЗАТЕЛЬНО – можно пропустить ход для дивизии или всех.
Можно ДРОБИТЬ войска: С одной клетки можно отправить в движение любое количество дивизий (от 1 до всех) на соседние клетки. Каждая движется независимо.

ВХОД НА КЛЕТКУ:
Пустая клетка: Дивизия занимает клетку. Контроль определяется наличием войск.
Клетка с противником: Происходит БОЙ.
Ресурсная клетка (4,4;4,5;5,4;5,5): При первом входе любой своей дивизии игрок получает бонус +1 дивизия (появляется в его домашней базе в начале следующего его хода). Ресурс исчерпывается навсегда.
База противника (🔵(0,0), 🟡(9,0), 🟢(9,9), ⚪(0,9)): При входе хотя бы одной своей дивизии на базу противника игрок получает бонус +10 дивизий (появляются в его домашней базе в начале следующего его хода). **ВАЖНО: Каждая база может быть захвачена только ОДИН раз!** Если база уже захвачена (помечена 🚫), бонус недоступен. Примечание: Если база защищена, сначала происходит бой. Бонус получает победитель боя, оставшийся на клетке базы.

⚔ БОЕВАЯ МЕХАНИКА:
Бой происходит автоматически при входе дивизии(й) на клетку, занятую войсками другого игрока.
Атакующий: Игрок, чья дивизия входит на клетку.
Защитник: Игрок, чьи дивизии находились на клетке.
Исход боя:
Победа Атакующего: Силы Атакующего - Силы Защитника = Остаток Атакующего. Защитник полностью уничтожается на этой клетке. Атакующий занимает клетку с оставшимися дивизиями.
Равные Силы (X vs X): Все дивизии на клетке (обеих сторон) уничтожаются. Клетка становится пустой.
Пример (Атакующий 5 vs Защитник 3): Атакующий побеждает, теряет 3 дивизии. На клетке остаются 2 дивизии Атакующего. Защитник уничтожен.

👁️‍🗨️ ТУМАН ВОЙНЫ:
Игрок видит только клетки, ортогонально или диагонально соседние (в радиусе 1 клетки) с клетками, на которых стоят его собственные дивизии.
Видимость динамична: Обновляется в начале каждого хода игрока. Если вражеская дивизия уходит из зоны видимости, клетка снова скрывается туманом.

✉️ ДИПЛОМАТИЯ:
За один ход можно отправить до двух текстовых сообщений.
Сообщения отправляются разным противникам (нельзя 2 одному).
Размер сообщения: Не более 1000 символов.
Содержание: Любой текст (предложения, вопросы, информация, условия, переговоры, дезинформация и т.д.).
Доставка: Сообщения видны только получателю и доставляются в начале его хода.

☠️ УНИЧТОЖЕНИЕ ИГРОКА
Игрок считается уничтоженным и выбывает из игры, если:
У него 0 дивизий на карте. (Главный критерий)
Дополнительные критерии (для администрирования неактивных игроков):
Он не отвечает на дипломатические сообщения.
От него нет активности в течение нескольких ходов.
По разведданным (игровой логике) его силы полностью разгромлены.

🏁 КОНЕЦ ИГРЫ И ПОБЕДА
ПОБЕДА: Остаться единственным игроком с дивизиями на карте.
НИЧЬЯ: Если на карте осталось ровно 2 игрока и у них одинаковое общее количество дивизий.
ПОБЕДА ПРИ 2-Х ИГРОКАХ: Если у одного игрока больше дивизий, он побеждает.

📌 КЛЮЧЕВЫЕ УСЛОВИЯ
Новых дивизий (кроме бонусов за ресурсы и базы) не появляется.
Контроль клетки определяется исключительно наличием на ней войск. Захват пустой клетки происходит автоматически при входе.
Максимальное количество дивизий: Не ограничено (кроме стартовых 10 и бонусов: +1 за ресурс, +10 за каждую базу противника).

📊 СТРУКТУРА КАРТЫ (boardStr):
Карта показывает 10x10 клеток с координатами (0,0) в левом верхнем углу.
СИМВОЛЫ НА КАРТЕ:
- 🔵(0,0), 🟡(9,0), 🟢(9,9), ⚪(0,9) - базы игроков
- 🚫 - база противника уже захвачена (бонус +10 дивизий недоступен)
- 💰 - центральный ресурс доступен (+1 дивизия)
- 🏜️ - центральный ресурс исчерпан
- С3, Ж5, Р2, З1 - войска игроков (С=Синий, Ж=Желтый, Р=Серый, З=Зеленый, цифра=количество)
- . - пустая клетка
- ? - клетка скрыта туманом войны

ФОРМАТ ОТВЕТА:
Отвечай ТОЛЬКО JSON без лишнего текста:

\`\`\`json
{
  "moves": [
    {
      "fromX": 0, "fromY": 0,
      "toX": 1, "toY": 0,
      "unitCount": 3
    }
  ],
  "diplomacy": [
    {
      "to": "gray",
      "content": "Текст сообщения"
    }
  ],
  "reasoning": "Объяснение стратегии"
}
\`\`\`

ТРЕБОВАНИЯ:
- В moves укажи ходы или пустой массив [] (пропуск хода)
- В diplomacy до 2 сообщений разным игрокам или пустой массив []
- Используй ТОЧНЫЕ координаты fromX/fromY из секции "ТВОИ ВОЙСКА"`;

        // User message with current game state
        const userPrompt = `ТЕКУЩАЯ СИТУАЦИЯ:
- Ход: ${currentTurn}
- ТВОИ ВОЙСКА: ${myUnitsStr}

${boardStr}

Сделай ход на основе текущей ситуации.`;

        return { systemPrompt, userPrompt };
    }

    async callOpenRouter(model, systemPrompt, userPrompt) {
        const requestBody = {
            model: model,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
            temperature: 0.3,
            max_tokens: 1500,
            top_p: 0.9
        };

        // ПОЛНЫЙ JSON ЗАПРОС К МОДЕЛИ
        console.log('📤 JSON запрос:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.getApiKey()}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.origin,
                'X-Title': 'AI Strategic Battle'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const error = await response.text();
            console.error(`❌ HTTP Error: ${response.status} - ${error}`);
            
            if (response.status === 429) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                throw new Error('Rate limit exceeded, retry after delay');
            }
            
            throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        // Сырой ответ от модели
        console.log('📥 Сырой ответ:', aiResponse);
        
        return aiResponse;
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

    // Generate commentator commentary
    async generateCommentary(gameEngine, lastMove = null) {
        if (!this.getApiKey()) {
            throw new Error('API ключ не настроен');
        }

        try {
            const { systemPrompt, userPrompt } = this.generateCommentatorPrompt(gameEngine, lastMove);
            
            const response = await this.callOpenRouter(this.commentatorModel, systemPrompt, userPrompt);
            
            if (!response || response.trim().length < 10) {
                throw new Error('Пустой или слишком короткий ответ от комментатора');
            }
            
            // Parse commentary response
            const commentary = this.parseCommentaryResponse(response);
            
            return commentary;
            
        } catch (error) {
            console.error(`❌ Ошибка комментатора:`, error.message);
            // Return fallback commentary
            return this.generateFallbackCommentary(gameEngine, lastMove);
        }
    }

    // Generate commentator prompt
    generateCommentatorPrompt(gameEngine, lastMove) {
        const systemPrompt = `Ты - ВОЕННЫЙ АНАЛИТИК стратегической игры. Твоя задача - АНАЛИЗИРОВАТЬ РЕАЛЬНУЮ ситуацию на карте.

🎯 КРИТИЧЕСКИ ВАЖНО:
- Анализируй ТОЛЬКО то что ВИДИШЬ на карте
- НЕ ВЫДУМЫВАЙ несуществующие угрозы или действия
- Используй ПРАВИЛЬНЫЕ направления: север (вверх), юг (вниз), запад (влево), восток (вправо)
- Фокусируйся на РЕАЛЬНЫХ тактических возможностях

📋 ЗАДАЧИ АНАЛИЗА:
1. 🚨 ТАКТИЧЕСКАЯ СИТУАЦИЯ:
   - Кто где находится и куда может двигаться
   - Какие реальные угрозы существуют
   - Упущенные возможности для атаки

2. 🎭 ДИПЛОМАТИЧЕСКИЕ РАСХОЖДЕНИЯ:
   - Сравни заявления с реальными действиями
   - Кто обманывает или не выполняет обещания

3. 🏰 СТРАТЕГИЧЕСКИЕ ЦЕЛИ:
   - Кто ближе к чужой базе для захвата (+10 дивизий)
   - Почему не атакуют доступные цели

📝 ФОРМАТ ОТВЕТА:
Отвечай ТОЛЬКО текстом анализа, максимум 2 предложения. Будь КОНКРЕТЕН и ТОЧЕН!`;

        // Create full game state for commentator
        let gameStateStr = "ПОЛНАЯ КАРТА ИГРЫ (комментатор видит всё):\n";
        gameStateStr += "   0 1 2 3 4 5 6 7 8 9\n";
        
        for (let y = 0; y < 10; y++) {
            gameStateStr += y + " ";
            for (let x = 0; x < 10; x++) {
                const cell = gameEngine.board[y][x];
                if (cell.units.length === 0) {
                    if (cell.resourceCell) {
                        gameStateStr += cell.depleted ? "🏜️ " : "💰 ";
                    } else {
                        gameStateStr += " . ";
                    }
                } else {
                    const unit = cell.units[0];
                    const playerSymbol = {
                        'blue': 'С',
                        'yellow': 'Ж', 
                        'gray': 'Р',
                        'green': 'З'
                    }[unit.player] || '?';
                    gameStateStr += unit.count < 10 ? ` ${playerSymbol}${unit.count}` : `${playerSymbol}${unit.count}`;
                }
            }
            gameStateStr += "\n";
        }
        
        // Add legend for commentator to understand the map
        gameStateStr += "\n📋 ЛЕГЕНДА КАРТЫ:\n";
        gameStateStr += "- С = Синий игрок (blue)\n";
        gameStateStr += "- Ж = Желтый игрок (yellow)\n";
        gameStateStr += "- Р = Серый игрок (gray)\n";
        gameStateStr += "- З = Зеленый игрок (green)\n";
        gameStateStr += "- 💰 = Центральный ресурс доступен (+1 дивизия) - ВАЖНО!\n";
        gameStateStr += "- 🏜️ = Центральный ресурс исчерпан\n";
        gameStateStr += "- . = Пустая клетка\n";
        gameStateStr += "- Цифра после буквы = количество дивизий на клетке\n";
        
        // Add directional reference for commentator
        gameStateStr += "\n🧭 НАПРАВЛЕНИЯ (ВАЖНО для анализа):\n";
        gameStateStr += "- Север (вверх): y уменьшается (0,0) → (0,1) → (0,2)...\n";
        gameStateStr += "- Юг (вниз): y увеличивается (0,9) → (0,8) → (0,7)...\n";
        gameStateStr += "- Запад (влево): x уменьшается (0,0) → (1,0) → (2,0)...\n";
        gameStateStr += "- Восток (вправо): x увеличивается (0,0) → (1,0) → (2,0)...\n";
        gameStateStr += "- Серый (0,9) находится ЗАПАДНЕЕ и ЮЖНЕЕ Синего (0,0)\n";
        gameStateStr += "- Желтый (9,0) находится ВОСТОЧНЕЕ и СЕВЕРНЕЕ Зеленого (9,9)\n";
        
        // Add REAL current status of central resources
        gameStateStr += "\n🚨 РЕАЛЬНЫЙ СТАТУС ЦЕНТРАЛЬНЫХ РЕСУРСОВ:\n";
        const centralCells = [
            { x: 4, y: 4 }, { x: 4, y: 5 },
            { x: 5, y: 4 }, { x: 5, y: 5 }
        ];
        
        centralCells.forEach(({ x, y }) => {
            const cell = gameEngine.board[y][x];
            if (cell.resourceCell) {
                if (cell.depleted) {
                    gameStateStr += `- Клетка (${x},${y}): 🏜️ РЕСУРС ИСЧЕРПАН\n`;
                } else {
                    gameStateStr += `- Клетка (${x},${y}): 💰 РЕСУРС ДОСТУПЕН (+1 дивизия)\n`;
                }
            }
        });
        
        // Add strategic analysis based on current resource status
        const availableResources = centralCells.filter(({ x, y }) => 
            gameEngine.board[y][x].resourceCell && !gameEngine.board[y][x].depleted
        ).length;
        
        if (availableResources === 0) {
            gameStateStr += "\n⚠️ ВАЖНО: ВСЕ центральные ресурсы уже захвачены!\n";
            gameStateStr += "- Теперь главная цель - захват баз противников (+10 дивизий)\n";
            gameStateStr += "- Анализируй, кто ближе к чужой базе и почему не атакует\n";
        } else {
            gameStateStr += `\n⚠️ ВАЖНО: Доступно ${availableResources} центральных ресурсов\n`;
            gameStateStr += "- Анализируй, кто пытается их захватить\n";
        }
        
        // Add tactical analysis hints
        gameStateStr += "\n🎯 ТАКТИЧЕСКИЙ АНАЛИЗ:\n";
        gameStateStr += "- Оцени позиционирование войск каждого игрока\n";
        gameStateStr += "- Ищи упущенные возможности и тактические ошибки\n";
        gameStateStr += "- Анализируй эффективность использования ресурсов\n";
        gameStateStr += "- Сравни заявленные цели с реальными действиями\n";
        
        // Add base capture analysis
        gameStateStr += "\n🏰 АНАЛИЗ ЗАХВАТА БАЗ:\n";
        const homeBases = {
            'blue': { x: 0, y: 0, name: 'Синий' },
            'yellow': { x: 9, y: 0, name: 'Желтый' },
            'green': { x: 9, y: 9, name: 'Зеленый' },
            'gray': { x: 0, y: 9, name: 'Серый' }
        };
        
        gameEngine.players.forEach(player => {
            if (player.units > 0) {
                // Find closest enemy base for this player
                let closestBase = null;
                let minDistance = Infinity;
                
                Object.entries(homeBases).forEach(([enemyId, base]) => {
                    if (enemyId !== player.id) {
                        // Find player's closest unit to this enemy base
                        for (let y = 0; y < 10; y++) {
                            for (let x = 0; x < 10; x++) {
                                const cell = gameEngine.board[y][x];
                                const playerUnitsOnCell = cell.units.filter(u => u.player === player.id);
                                if (playerUnitsOnCell.length > 0) {
                                    const distance = Math.abs(x - base.x) + Math.abs(y - base.y);
                                    if (distance < minDistance) {
                                        minDistance = distance;
                                        closestBase = { ...base, distance };
                                    }
                                }
                            }
                        }
                    }
                });
                
                if (closestBase) {
                    gameStateStr += `- ${player.name}: ближайшая база противника ${closestBase.name} на расстоянии ${closestBase.distance} клеток\n`;
                    if (closestBase.distance <= 3) {
                        gameStateStr += `  ⚠️ ${player.name} МОЖЕТ АТАКОВАТЬ базу ${closestBase.name} за 1-2 хода!\n`;
                    }
                }
            }
        });

        // Add players status
        let playersStr = "\n👥 СТАТУС ИГРОКОВ:\n";
        gameEngine.players.forEach(p => {
            playersStr += `- ${p.name}: ${p.units} дивизий ${p.units > 0 ? '(жив)' : '(мертв)'}\n`;
        });
        
        // Add detailed unit positions for better analysis
        let positionsStr = "\n📍 РАСПОЛОЖЕНИЕ ВОЙСК:\n";
        gameEngine.players.forEach(p => {
            if (p.units > 0) {
                const playerUnits = [];
                for (let y = 0; y < 10; y++) {
                    for (let x = 0; x < 10; x++) {
                        const cell = gameEngine.board[y][x];
                        const playerUnitsOnCell = cell.units.filter(u => u.player === p.id);
                        if (playerUnitsOnCell.length > 0) {
                            const totalUnits = playerUnitsOnCell.reduce((sum, u) => sum + u.count, 0);
                            playerUnits.push(`(${x},${y}): ${totalUnits} дивизий`);
                        }
                    }
                }
                positionsStr += `- ${p.name}: ${playerUnits.join(', ')}\n`;
            }
        });

        // Add diplomacy summary
        let diplomacyStr = "\n💬 ДИПЛОМАТИЧЕСКАЯ АКТИВНОСТЬ:\n";
        const allMessages = [];
        gameEngine.players.forEach(player => {
            player.diplomacyHistory.forEach(msg => {
                if (msg.type === 'sent') {
                    allMessages.push({
                        ...msg,
                        fromName: player.name,
                        toName: gameEngine.players.find(p => p.id === msg.to)?.name || 'Unknown'
                    });
                }
            });
        });
        
        if (allMessages.length > 0) {
            // Show more messages for better analysis
            const recentMessages = allMessages.slice(-6);
            diplomacyStr += "📊 ДИПЛОМАТИЧЕСКАЯ ИСТОРИЯ (для анализа):\n";
            recentMessages.forEach(msg => {
                const turnInfo = `[Ход ${msg.turn}]`;
                const messagePreview = msg.content.length > 60 ? 
                    msg.content.substring(0, 60) + '...' : 
                    msg.content;
                diplomacyStr += `- ${turnInfo} ${msg.fromName} → ${msg.toName}: "${messagePreview}"\n`;
            });
            
            // Add analysis instructions
            diplomacyStr += "\n🔍 АНАЛИЗ ДИПЛОМАТИИ:\n";
            diplomacyStr += "- Сравни заявления с реальными действиями на карте\n";
            diplomacyStr += "- Ищи обманы, блеф и невыполненные обещания\n";
            diplomacyStr += "- Оцени, кто соблюдает, а кто нарушает договоренности\n";
            diplomacyStr += "- Выяви скрытые мотивы за дипломатическими маневрами\n";
        } else {
            diplomacyStr += "- Пока нет дипломатических сообщений\n";
            diplomacyStr += "- Анализируй только военную тактику\n";
        }

        // Add last move context if available
        let moveContextStr = "";
        if (lastMove) {
            moveContextStr = `\n🎯 ПОСЛЕДНИЙ ХОД:\n`;
            moveContextStr += `- ${lastMove.playerName} сделал ${lastMove.movesCount} ходов`;
            if (lastMove.diplomacyCount > 0) {
                moveContextStr += `, отправил ${lastMove.diplomacyCount} дипломатических сообщений`;
            }
            moveContextStr += `\n`;
        }

        const userPrompt = `ТЕКУЩАЯ СИТУАЦИЯ В ИГРЕ:
- Ход: ${gameEngine.currentTurn}
- Текущий игрок: ${gameEngine.players[gameEngine.currentPlayerIndex]?.name || 'Неизвестно'}

🔍 ДАННЫЕ ДЛЯ АНАЛИЗА:

🚨 ВОЕННАЯ СИТУАЦИЯ:
${gameStateStr}

${playersStr}

${positionsStr}

🎭 ДИПЛОМАТИЧЕСКАЯ ИСТОРИЯ:
${diplomacyStr}

${moveContextStr}

🎯 ЗАДАЧА АНАЛИТИКА:
ПРОВЕДИ КОНКРЕТНЫЙ АНАЛИЗ РЕАЛЬНОЙ СИТУАЦИИ:

1. **ПОЗИЦИИ И НАПРАВЛЕНИЯ**: Кто где находится? Какие реальные угрозы существуют?

2. **УПУЩЕННЫЕ ВОЗМОЖНОСТИ**: Кто ближе к чужой базе для захвата (+10 дивизий)? Почему не атакует?

3. **ТАКТИЧЕСКИЕ ОШИБКИ**: Кто движется в неправильном направлении от своих целей?

4. **ДИПЛОМАТИЧЕСКИЕ РАСХОЖДЕНИЯ**: Кто что обещает и выполняет ли это?

⚠️ ВАЖНО: Анализируй ТОЛЬКО то что ВИДИШЬ на карте! НЕ ВЫДУМЫВАЙ несуществующие угрозы!
Используй ПРАВИЛЬНЫЕ направления: север (вверх), юг (вниз), запад (влево), восток (вправо)!`;

        return { systemPrompt, userPrompt };
    }

    // Parse commentary response
    parseCommentaryResponse(response) {
        // Clean up response - remove markdown, extra formatting
        let commentary = response.trim();
        
        // Remove code blocks if present
        commentary = commentary.replace(/```.*?```/gs, '');
        
        // Remove quotes if present
        commentary = commentary.replace(/^["']|["']$/g, '');
        
        // Limit length
        if (commentary.length > 200) {
            commentary = commentary.substring(0, 200) + '...';
        }
        
        return commentary;
    }

    // Generate fallback commentary
    generateFallbackCommentary(gameEngine, lastMove) {
        const alivePlayers = gameEngine.players.filter(p => p.units > 0);
        const totalMessages = gameEngine.players.reduce((sum, p) => sum + p.diplomacyHistory.length, 0);
        
        if (alivePlayers.length <= 1) {
            return "Игра подходит к концу - остался только один выживший!";
        }
        
        if (totalMessages > 0) {
            // Analyze diplomatic activity for fallback
            const recentMessages = [];
            gameEngine.players.forEach(player => {
                player.diplomacyHistory.forEach(msg => {
                    if (msg.type === 'sent') {
                        recentMessages.push({
                            from: player.name,
                            to: gameEngine.players.find(p => p.id === msg.to)?.name || 'Unknown',
                            turn: msg.turn
                        });
                    }
                });
            });
            
            if (recentMessages.length > 0) {
                const latestMessage = recentMessages[recentMessages.length - 1];
                return `Анализ: ${latestMessage.from} ведет переговоры с ${latestMessage.to} - проверим выполнение обещаний!`;
            }
            
            return "Дипломатия активна - анализируем соответствие слов и дел!";
        }
        
        // Analyze current tactical situation for fallback
        const centralCells = [
            { x: 4, y: 4 }, { x: 4, y: 5 },
            { x: 5, y: 4 }, { x: 5, y: 5 }
        ];
        
        const availableResources = centralCells.filter(({ x, y }) => 
            gameEngine.board[y][x].resourceCell && !gameEngine.board[y][x].depleted
        ).length;
        
        if (availableResources === 0) {
            return "Анализ: Все центральные ресурсы захвачены - фокус на захвате баз противников (+10 дивизий)!";
        } else {
            return `Анализ: Доступно ${availableResources} центральных ресурсов - анализируем тактику захвата!`;
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