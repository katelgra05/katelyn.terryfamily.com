# IO Arena - Multiplayer Battle Game

A real-time multiplayer IO-style battle game with multiple game modes, built with HTML5 Canvas and WebSockets.

## Features

### 🎮 Game Modes
- **Free For All (FFA)**: Classic battle royale where everyone fights everyone
- **Teams**: Red vs Blue team battles with respawns
- **Duel**: 1v1 private battles with matchmaking

### 🎯 Gameplay
- **Movement**: WASD keys for smooth movement
- **Aiming**: Mouse to aim in any direction
- **Shooting**: Click to shoot bullets
- **Food Collection**: Collect colorful food to grow larger
- **Power-ups**: Collect special power-ups for temporary advantages
- **Health System**: Players have health that regenerates over time

### ⚡ Power-ups
- **Speed Boost** ⚡: Increased movement speed
- **Size Increase** 📈: Larger player size
- **Rapid Fire** 🔥: Faster shooting rate
- **Shield** 🛡️: Protective barrier

### 🏆 UI Features
- **Real-time Leaderboard**: Shows top players by size and health
- **Minimap**: Bird's eye view of the game world
- **Player Count**: Live player count display
- **Connection Status**: Real-time connection indicator
- **Team Indicators**: Visual team identification in team mode
- **Duel Waiting Screen**: Shows when waiting for duel opponent

## How to Play

### Starting the Server

#### Option 1: Python Server (Recommended)
```bash
cd games
python3 io-server-python.py
```
The server will start on `ws://localhost:8080`

#### Option 2: Node.js Server
```bash
cd games
node io-server.js
```

### Playing the Game

1. **Open the Game**: Open `io-game-multiplayer.html` in your web browser
2. **Main Menu**: You'll see a beautiful main menu with:
   - Game mode selection (FFA, Teams, Duel)
   - Player name input
   - Player color picker
   - Play button
3. **Select Your Options**:
   - Choose your preferred game mode
   - Enter a unique player name
   - Pick your favorite color
4. **Click Play**: The game will connect to the server and start
5. **Game Controls**:
   - **WASD**: Move around the world
   - **Mouse**: Aim your shots
   - **Click**: Shoot bullets
   - **Collect Food**: Grow larger and earn points
   - **Avoid Bullets**: Stay alive to win!

### Game Modes Explained

#### Free For All (FFA)
- Everyone fights everyone
- Last player standing wins
- No respawns - when you die, you're out
- Perfect for quick, intense battles

#### Teams
- Players are automatically assigned to Red or Blue teams
- Team colors are enforced (Red team = red color, Blue team = blue color)
- Players respawn when killed
- Team-based leaderboard
- Work together with your teammates!

#### Duel
- 1v1 private battles
- Automatic matchmaking system
- Players are paired when two join the queue
- Winner takes all - no respawns
- Perfect for competitive 1v1 matches

## Technical Details

### Server Requirements
- **Python 3.7+** with `websockets` package, OR
- **Node.js** with `ws` package

### Client Requirements
- Modern web browser with WebSocket support
- No additional software needed

### Network
- WebSocket connection to `ws://localhost:8080`
- Real-time bidirectional communication
- Automatic reconnection handling

## Development

### File Structure
```
games/
├── io-game-multiplayer.html    # Main game client
├── io-server-python.py         # Python WebSocket server
├── io-server.js               # Node.js WebSocket server
└── README.md                  # This file
```

### Key Features Implemented
- ✅ Real-time multiplayer with WebSockets
- ✅ Multiple game modes (FFA, Teams, Duel)
- ✅ Main menu with player customization
- ✅ Team assignment and management
- ✅ Duel matchmaking system
- ✅ Power-up system
- ✅ Health and damage system
- ✅ Leaderboard and UI
- ✅ Minimap
- ✅ Particle effects
- ✅ Responsive design

### Future Enhancements
- [ ] More power-up types
- [ ] Custom maps/arenas
- [ ] Chat system
- [ ] Spectator mode
- [ ] Tournament system
- [ ] Mobile support
- [ ] Sound effects and music

## Troubleshooting

### Server Won't Start
- Make sure you're in the `games` directory
- For Python: Install websockets with `pip3 install websockets`
- For Node.js: Install dependencies with `npm install`

### Can't Connect to Server
- Ensure the server is running on port 8080
- Check that your firewall allows local connections
- Try refreshing the browser page

### Game Performance Issues
- Close other browser tabs to free up memory
- Try a different browser
- Check your internet connection for multiplayer

## Credits

Built with:
- HTML5 Canvas for rendering
- WebSockets for real-time communication
- Vanilla JavaScript for game logic
- CSS3 for beautiful UI design

Enjoy the game! 🎮 