#!/usr/bin/env python3
"""
Simple WebSocket server for IO Arena multiplayer game
Requires: pip install websockets
"""

import asyncio
import websockets
import json
import random
import time
from typing import Dict, List, Set

# Game state
class GameState:
    def __init__(self):
        self.players = {}  # player_id -> player_data
        self.bullets = {}  # bullet_id -> bullet_data
        self.food = {}     # food_id -> food_data
        self.power_ups = {} # powerup_id -> powerup_data
        self.world_size = 5000
        self.next_id = 1
        self.team_assignment = {'red': 0, 'blue': 0}
        self.duel_queue = []
        self.duel_rooms = {}  # room_id -> [player_id1, player_id2]

# Game constants
FOOD_COUNT = 100
POWER_UP_TYPES = [
    {'name': 'Speed Boost', 'icon': '⚡', 'duration': 5000, 'color': '#ffd700'},
    {'name': 'Size Increase', 'icon': '📈', 'duration': 8000, 'color': '#ff6b6b'},
    {'name': 'Rapid Fire', 'icon': '🔥', 'duration': 6000, 'color': '#ff4500'},
    {'name': 'Shield', 'icon': '🛡️', 'duration': 4000, 'color': '#00bfff'}
]

TEAM_COLORS = {'red': '#ff4444', 'blue': '#448aff'}

# Global game state
game_state = GameState()

def get_random_color():
    colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff', '#5f27cd']
    return random.choice(colors)

def generate_food():
    """Generate initial food"""
    for i in range(FOOD_COUNT):
        food = {
            'id': game_state.next_id,
            'x': random.random() * game_state.world_size,
            'y': random.random() * game_state.world_size,
            'size': 3 + random.random() * 2,
            'color': get_random_color()
        }
        game_state.food[food['id']] = food
        game_state.next_id += 1

def get_visible_players(for_player):
    """Get visible players for a given player based on mode"""
    if not for_player:
        return list(game_state.players.values())
    
    if for_player['mode'] == 'ffa':
        return [p for p in game_state.players.values() if p['mode'] == 'ffa']
    elif for_player['mode'] == 'teams':
        return [p for p in game_state.players.values() if p['mode'] == 'teams' and p['team'] == for_player['team']]
    elif for_player['mode'] == 'duel':
        return [p for p in game_state.players.values() if p['mode'] == 'duel' and p['room'] == for_player['room']]
    return []

def get_visible_bullets(for_player):
    """Get visible bullets for a given player based on mode"""
    if not for_player:
        return list(game_state.bullets.values())
    
    visible_bullets = []
    for bullet in game_state.bullets.values():
        owner = game_state.players.get(bullet['owner'])
        if not owner:
            continue
            
        if for_player['mode'] == 'ffa' and owner['mode'] == 'ffa':
            visible_bullets.append(bullet)
        elif for_player['mode'] == 'teams' and owner['mode'] == 'teams' and owner['team'] == for_player['team']:
            visible_bullets.append(bullet)
        elif for_player['mode'] == 'duel' and owner['mode'] == 'duel' and owner['room'] == for_player['room']:
            visible_bullets.append(bullet)
    
    return visible_bullets

def send_game_state(websocket, for_player=None):
    """Send game state to a client"""
    state = {
        'type': 'gameState',
        'data': {
            'players': get_visible_players(for_player),
            'bullets': get_visible_bullets(for_player),
            'food': list(game_state.food.values()),
            'powerUps': list(game_state.power_ups.values())
        }
    }
    asyncio.create_task(websocket.send(json.dumps(state)))

def broadcast(message, filter_fn=None):
    """Broadcast message to all connected clients"""
    for websocket in connected_websockets:
        if websocket.open:
            if not filter_fn or filter_fn(websocket):
                asyncio.create_task(websocket.send(json.dumps(message)))

def update_game():
    """Update game logic"""
    # Update bullets
    bullets_to_remove = []
    for bullet_id, bullet in game_state.bullets.items():
        bullet['x'] += bullet['vx']
        bullet['y'] += bullet['vy']
        bullet['life'] -= 1
        
        # Remove bullets that are out of bounds or expired
        if (bullet['life'] <= 0 or 
            bullet['x'] < 0 or bullet['x'] > game_state.world_size or
            bullet['y'] < 0 or bullet['y'] > game_state.world_size):
            bullets_to_remove.append(bullet_id)
            broadcast({'type': 'bulletRemoved', 'bulletId': bullet_id})
    
    for bullet_id in bullets_to_remove:
        del game_state.bullets[bullet_id]
    
    # Check bullet collisions
    bullets_to_remove = []
    for bullet_id, bullet in game_state.bullets.items():
        owner = game_state.players.get(bullet['owner'])
        if not owner:
            continue
            
        for player_id, player in game_state.players.items():
            if player_id == bullet['owner']:
                continue
                
            # Only interact if in same mode/team/room
            if owner['mode'] != player['mode']:
                continue
            if owner['mode'] == 'teams' and owner['team'] != player['team']:
                continue
            if owner['mode'] == 'duel' and owner['room'] != player['room']:
                continue
                
            dist = ((player['x'] - bullet['x']) ** 2 + (player['y'] - bullet['y']) ** 2) ** 0.5
            if dist < player['size'] + bullet['size']:
                # Hit!
                player['health'] -= 20
                bullets_to_remove.append(bullet_id)
                broadcast({'type': 'bulletRemoved', 'bulletId': bullet_id})
                
                if player['health'] <= 0:
                    killer = game_state.players.get(bullet['owner'])
                    if killer:
                        killer['score'] += 100
                        killer['kills'] += 1
                    
                    # Broadcast kill event
                    broadcast({
                        'type': 'playerKilled',
                        'victimName': player['name'],
                        'killerName': killer['name'] if killer else 'Unknown',
                        'victimId': player_id
                    })
                    
                    # Handle different modes
                    if player['mode'] == 'teams':
                        # Teams: allow respawn, keep team assignment
                        player['x'] = random.random() * game_state.world_size
                        player['y'] = random.random() * game_state.world_size
                        player['health'] = player['maxHealth']
                        player['powerUps'] = {}
                        player['score'] = 0
                        player['kills'] = 0
                        broadcast({'type': 'playerUpdate', 'player': player})
                    elif player['mode'] == 'duel':
                        # Duel: end duel for both players
                        room_id = player['room']
                        if room_id and room_id in game_state.duel_rooms:
                            ids = game_state.duel_rooms[room_id]
                            for id in ids:
                                p = game_state.players.get(id)
                                if p:
                                    # Send duel result
                                    for ws in connected_websockets:
                                        if hasattr(ws, 'player_id') and ws.player_id == id:
                                            asyncio.create_task(ws.send(json.dumps({
                                                'type': 'duelResult',
                                                'yourName': p['name'],
                                                'yourScore': p['score'],
                                                'survivedMs': int(time.time() * 1000) - (p.get('joinedAt', int(time.time() * 1000))),
                                                'winner': (id != player_id)
                                            })))
                                            break
                                    # Remove from game
                                    del game_state.players[id]
                                    broadcast({'type': 'playerLeft', 'playerId': id})
                            del game_state.duel_rooms[room_id]
                    else:
                        # FFA: remove player
                        del game_state.players[player_id]
                        broadcast({'type': 'playerLeft', 'playerId': player_id})
                else:
                    broadcast({'type': 'playerUpdate', 'player': player})
                break
    
    for bullet_id in bullets_to_remove:
        if bullet_id in game_state.bullets:
            del game_state.bullets[bullet_id]
    
    # Check food collisions
    food_to_remove = []
    for food_id, food in game_state.food.items():
        for player_id, player in game_state.players.items():
            dist = ((player['x'] - food['x']) ** 2 + (player['y'] - food['y']) ** 2) ** 0.5
            if dist < player['size'] + food['size']:
                # Eat food
                player['size'] = min(100, player['size'] + 0.5)
                player['score'] += 10
                
                # Remove food
                food_to_remove.append(food_id)
                broadcast({'type': 'foodRemoved', 'foodId': food_id})
                
                # Update player
                broadcast({'type': 'playerUpdate', 'player': player})
                broadcast({
                    'type': 'playerStats',
                    'playerId': player_id,
                    'stats': {'score': player['score'], 'kills': player['kills']}
                })
                break
    
    for food_id in food_to_remove:
        del game_state.food[food_id]
    
    # Regenerate food if needed
    if len(game_state.food) < FOOD_COUNT // 2:
        food = {
            'id': game_state.next_id,
            'x': random.random() * game_state.world_size,
            'y': random.random() * game_state.world_size,
            'size': 3 + random.random() * 2,
            'color': get_random_color()
        }
        game_state.food[food['id']] = food
        game_state.next_id += 1
        broadcast({'type': 'foodCreated', 'food': food})
    
    # Broadcast player count
    broadcast({'type': 'playerCount', 'count': len(game_state.players)})

# Store connected websockets
connected_websockets = set()
async def handle_client(websocket, path):
    """Handle client connection"""
    connected_websockets.add(websocket)
    print(f"New client connected. Total clients: {len(connected_websockets)}")
    
    # Send initial game state
    send_game_state(websocket)
    
    try:
        async for message in websocket:
            print(f"[DEBUG] Received message: {message}")  # Debug log
            try:
                data = json.loads(message)
                
                if data['type'] == 'join':
                    mode = data.get('mode', 'ffa')
                    color = data.get('playerColor', get_random_color())
                    team = None
                    room = None
                    assigned_color = color
                    
                    if mode == 'teams':
                        # Assign to team with fewer players
                        if game_state.team_assignment['red'] <= game_state.team_assignment['blue']:
                            team = 'red'
                            assigned_color = TEAM_COLORS['red']
                            game_state.team_assignment['red'] += 1
                        else:
                            team = 'blue'
                            assigned_color = TEAM_COLORS['blue']
                            game_state.team_assignment['blue'] += 1
                    elif mode == 'duel':
                        # Add to duel queue
                        game_state.duel_queue.append(game_state.next_id)
                        if len(game_state.duel_queue) >= 2:
                            p1 = game_state.duel_queue.pop(0)
                            p2 = game_state.duel_queue.pop(0)
                            room_id = f"duel_{int(time.time() * 1000)}_{random.randint(0, 9999)}"
                            game_state.duel_rooms[room_id] = [p1, p2]
                    
                    # Create new player
                    player = {
                        'id': game_state.next_id,
                        'x': random.random() * game_state.world_size,
                        'y': random.random() * game_state.world_size,
                        'vx': 0,
                        'vy': 0,
                        'size': 20,
                        'color': assigned_color,
                        'name': data['playerName'],
                        'health': 100,
                        'maxHealth': 100,
                        'powerUps': {},
                        'score': 0,
                        'kills': 0,
                        'lastShot': 0,
                        'shotCooldown': 200,
                        'mode': mode,
                        'team': team,
                        'room': room,
                        'joinedAt': int(time.time() * 1000)
                    }
                    
                    game_state.players[player['id']] = player
                    websocket.player_id = player['id']
                    
                    # If duel, assign room to both players
                    if mode == 'duel':
                        for room_id, ids in game_state.duel_rooms.items():
                            if player['id'] in ids:
                                player['room'] = room_id
                                # Assign to other player too
                                for id in ids:
                                    p = game_state.players.get(id)
                                    if p:
                                        p['room'] = room_id
                    
                    # Send player their info
                    await websocket.send(json.dumps({
                        'type': 'playerJoined',
                        'player': player
                    }))
                    
                    # Broadcast to other players
                    broadcast({'type': 'playerJoined', 'player': player})
                    print(f"Player {data['playerName']} joined mode={mode} team={team} room={player['room'] or ''}")
                    game_state.next_id += 1
                
                elif data['type'] == 'move':
                    # Find player by websocket
                    for player_id, player in game_state.players.items():
                        if hasattr(websocket, 'player_id') and websocket.player_id == player_id:
                            player['vx'] = data['vx']
                            player['vy'] = data['vy']
                            
                            # Apply movement
                            player['x'] += player['vx']
                            player['y'] += player['vy']
                            
                            # Keep player in bounds
                            player['x'] = max(player['size'], min(game_state.world_size - player['size'], player['x']))
                            player['y'] = max(player['size'], min(game_state.world_size - player['size'], player['y']))
                            
                            # Regenerate health
                            player['health'] = min(player['maxHealth'], player['health'] + 0.02)
                            
                            # Broadcast player update
                            broadcast({'type': 'playerUpdate', 'player': player})
                            break
                
                elif data['type'] == 'shoot':
                    # Find player by websocket
                    for player_id, player in game_state.players.items():
                        if hasattr(websocket, 'player_id') and websocket.player_id == player_id:
                            now = int(time.time() * 1000)
                            if now - player['lastShot'] < player['shotCooldown']:
                                break
                            
                            # Apply power-up effects
                            shot_cooldown = 200
                            if 'Rapid Fire' in player.get('powerUps', {}):
                                shot_cooldown = 100
                            
                            if now - player['lastShot'] >= shot_cooldown:
                                bullet = {
                                    'id': game_state.next_id,
                                    'x': player['x'],
                                    'y': player['y'],
                                    'vx': 15 * data['angle'],
                                    'vy': 15 * data['angle'],
                                    'size': 4,
                                    'color': player['color'],
                                    'owner': player_id,
                                    'life': 100
                                }
                                
                                game_state.bullets[bullet['id']] = bullet
                                player['lastShot'] = now
                                game_state.next_id += 1
                                
                                # Broadcast bullet creation
                                broadcast({'type': 'bulletCreated', 'bullet': bullet})
                            break
                
                elif data['type'] == 'respawn':
                    # Find player by websocket
                    for player_id, player in game_state.players.items():
                        if hasattr(websocket, 'player_id') and websocket.player_id == player_id:
                            # Reset player
                            player['x'] = random.random() * game_state.world_size
                            player['y'] = random.random() * game_state.world_size
                            player['health'] = player['maxHealth']
                            player['powerUps'] = {}
                            player['score'] = 0
                            player['kills'] = 0
                            
                            # Broadcast player update
                            broadcast({'type': 'playerUpdate', 'player': player})
                            break
                            
            except json.JSONDecodeError:
                print("Invalid JSON received")
            except Exception as e:
                print(f"Error handling message: {e}")
                
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # Handle client disconnect
        connected_websockets.remove(websocket)
        print(f"Client disconnected. Total clients: {len(connected_websockets)}")
        
        # Clean up player
        if hasattr(websocket, 'player_id'):
            player_id = websocket.player_id
            if player_id in game_state.players:
                player = game_state.players[player_id]
                
                # Clean up team assignment
                if player['mode'] == 'teams' and player['team']:
                    game_state.team_assignment[player['team']] = max(0, game_state.team_assignment[player['team']] - 1)
                
                # Clean up duel room
                if player['mode'] == 'duel' and player['room'] and player['room'] in game_state.duel_rooms:
                    ids = game_state.duel_rooms[player['room']]
                    for id in ids:
                        if id != player_id:
                            p = game_state.players.get(id)
                            if p:
                                # Inform other player duel ended
                                for ws in connected_websockets:
                                    if hasattr(ws, 'player_id') and ws.player_id == id:
                                        asyncio.create_task(ws.send(json.dumps({
                                            'type': 'duelResult',
                                            'yourName': p['name'],
                                            'yourScore': p['score'],
                                            'survivedMs': int(time.time() * 1000) - (p.get('joinedAt', int(time.time() * 1000))),
                                            'winner': False
                                        })))
                                        break
                                del game_state.players[id]
                                broadcast({'type': 'playerLeft', 'playerId': id})
                    del game_state.duel_rooms[player['room']]
                
                del game_state.players[player_id]
                broadcast({'type': 'playerLeft', 'playerId': player_id})
                print(f"Player {player['name']} left")

async def game_loop():
    """Main game loop"""
    while True:
        update_game()
        await asyncio.sleep(0.016)  # ~60fps

async def main():
    """Main function"""
    # Generate initial food
    generate_food()
    
    # Start game loop
    asyncio.create_task(game_loop())
    
    # Start WebSocket server
    server = await websockets.serve(handle_client, "localhost", 8080)
    print("IO Game Server running on ws://localhost:8080")
    
    await server.wait_closed()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down server...") 