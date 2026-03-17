import React, { useEffect, useRef, useState } from 'react';

// Declare MediaPipe globals
declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}

type GameMode = 'menu' | 'story' | 'endless' | 'gameover' | 'win';
type ItemType = 'debris' | 'satellite' | 'bonus_score' | 'bonus_slow' | 'bomb' | 'boss_ship';

interface GameItem {
  id: number;
  type: ItemType;
  emoji: string;
  x: number;
  y: number;
  size: number;
  speed: number;
  isGrabbed: boolean;
  grabbedBy: 'left' | 'right' | 'both' | null;
  isLarge: boolean;
}

interface Obstacle {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  direction: number;
}

const DEBRIS_EMOJIS = ['🪨', '🔩', '🗑️'];
const SATELLITE_EMOJIS = ['🛰️', '🚀'];
const BONUS_SCORE_EMOJI = '⭐';
const BONUS_SLOW_EMOJI = '⏱️';
const BOMB_EMOJI = '💣';
const BOSS_EMOJI = '👾';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [uiMode, setUiMode] = useState<GameMode>('menu');
  const [finalScore, setFinalScore] = useState(0);
  const isMediaPipeInitialized = useRef(false);
  
  // Game state refs (to avoid stale closures in requestAnimationFrame)
  const gameState = useRef({
    mode: 'menu' as GameMode,
    level: 1,
    score: 0,
    lives: 5,
    items: [] as GameItem[],
    obstacles: [] as Obstacle[],
    boss: { active: false, hp: 100, maxHp: 100, x: 0, y: 120, speed: 4, direction: 1 },
    effects: { slowUntil: 0 },
    cursors: { left: { x: 0, y: 0, isGrabbing: false, grabbedItemId: null as number | null }, right: { x: 0, y: 0, isGrabbing: false, grabbedItemId: null as number | null } },
    lastSpawnTime: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
        gameState.current.width = window.innerWidth;
        gameState.current.height = window.innerHeight;
      }
    };
    
    window.addEventListener('resize', handleResize);
    handleResize();
    
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const initGame = (mode: 'story' | 'endless') => {
    gameState.current = {
      ...gameState.current,
      mode: mode,
      level: 1,
      score: 0,
      lives: 5,
      items: [],
      obstacles: [],
      boss: { active: false, hp: 100, maxHp: 100, x: window.innerWidth / 2, y: 120, speed: 4, direction: 1 },
      effects: { slowUntil: 0 },
      cursors: { left: { x: 0, y: 0, isGrabbing: false, grabbedItemId: null }, right: { x: 0, y: 0, isGrabbing: false, grabbedItemId: null } },
    };
    setUiMode(mode);

    if (!isMediaPipeInitialized.current) {
      isMediaPipeInitialized.current = true;
      startMediaPipe();
    }
  };

  const startMediaPipe = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const videoElement = videoRef.current;
    const canvasElement = canvasRef.current;
    const canvasCtx = canvasElement.getContext('2d');
    
    if (!canvasCtx) return;

    const hands = new window.Hands({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    hands.onResults((results: any) => {
      const state = gameState.current;
      
      // Clear canvas
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      
      // Draw video frame
      canvasCtx.save();
      canvasCtx.translate(canvasElement.width, 0);
      canvasCtx.scale(-1, 1);
      canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
      canvasCtx.restore();

      // If not playing, just show camera background
      if (state.mode !== 'story' && state.mode !== 'endless') {
        return;
      }

      // Process Hand Landmarks
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Reset grab states temporarily
        state.cursors.left.isGrabbing = false;
        state.cursors.right.isGrabbing = false;

        results.multiHandLandmarks.forEach((landmarks: any, index: number) => {
          const handedness = results.multiHandedness[index].label === 'Left' ? 'right' : 'left'; // Mirrored
          const cursor = state.cursors[handedness as 'left' | 'right'];

          // Draw hand landmarks
          canvasCtx.save();
          canvasCtx.translate(canvasElement.width, 0);
          canvasCtx.scale(-1, 1);
          window.drawConnectors(canvasCtx, landmarks, window.HAND_CONNECTIONS, {color: handedness === 'left' ? '#00FF00' : '#0000FF', lineWidth: 2});
          window.drawLandmarks(canvasCtx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
          canvasCtx.restore();

          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          
          const thumbX = (1 - thumbTip.x) * state.width;
          const thumbY = thumbTip.y * state.height;
          const indexX = (1 - indexTip.x) * state.width;
          const indexY = indexTip.y * state.height;
          
          const dx = indexX - thumbX;
          const dy = indexY - thumbY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          cursor.x = (thumbX + indexX) / 2;
          cursor.y = (thumbY + indexY) / 2;
          
          if (distance < 30) {
            cursor.isGrabbing = true;
            if (cursor.grabbedItemId === null) {
              // Try to grab an item
              for (let i = state.items.length - 1; i >= 0; i--) {
                const item = state.items[i];
                const distToItem = Math.sqrt(Math.pow(cursor.x - item.x, 2) + Math.pow(cursor.y - item.y, 2));
                
                if (distToItem < item.size * 1.5) {
                  if (item.isLarge) {
                    // Large items need both hands
                    if (item.grabbedBy === null) {
                      item.grabbedBy = handedness as 'left' | 'right';
                      cursor.grabbedItemId = item.id;
                      break;
                    } else if (item.grabbedBy !== handedness && item.grabbedBy !== 'both') {
                      item.grabbedBy = 'both';
                      cursor.grabbedItemId = item.id;
                      break;
                    }
                  } else {
                    if (item.grabbedBy === null) {
                      item.isGrabbed = true;
                      item.grabbedBy = handedness as 'left' | 'right';
                      cursor.grabbedItemId = item.id;
                      break;
                    }
                  }
                }
              }
            }
          } else {
            cursor.isGrabbing = false;
            
            // Release grabbed item
            if (cursor.grabbedItemId !== null) {
              const item = state.items.find(i => i.id === cursor.grabbedItemId);
              if (item) {
                if (item.isLarge) {
                  if (item.grabbedBy === 'both') {
                    item.grabbedBy = handedness === 'left' ? 'right' : 'left';
                  } else {
                    item.grabbedBy = null;
                    item.isGrabbed = false;
                  }
                } else {
                  item.isGrabbed = false;
                  item.grabbedBy = null;
                }
                
                // Only process drop if fully released
                if (item.grabbedBy === null) {
                  const incinWidth = 200;
                  const incinHeight = 200;
                  const incinX = state.width / 2 - incinWidth / 2;
                  const incinY = state.height / 2 - incinHeight / 2;
                  
                  // Check Boss Collision (for bombs)
                  let hitBoss = false;
                  if (item.type === 'bomb' && state.boss.active) {
                    const distToBoss = Math.sqrt(Math.pow(item.x - state.boss.x, 2) + Math.pow(item.y - state.boss.y, 2));
                    if (distToBoss < 120) {
                      state.boss.hp -= item.isLarge ? 40 : 20;
                      state.items = state.items.filter(i => i.id !== item.id);
                      hitBoss = true;
                    }
                  }

                  // Check Incinerator Collision
                  const incinCenterX = state.width / 2;
                  const incinCenterY = state.height / 2;
                  const distToIncin = Math.sqrt(Math.pow(item.x - incinCenterX, 2) + Math.pow(item.y - incinCenterY, 2));
                  
                  if (!hitBoss && distToIncin < 100) {
                    state.items = state.items.filter(i => i.id !== item.id);
                    
                    const scoreMultiplier = item.isLarge ? 3 : 1;
                    if (item.type === 'debris') state.score += 10 * scoreMultiplier;
                    else if (item.type === 'satellite') { state.score = Math.max(0, state.score - 20 * scoreMultiplier); state.lives -= 1; }
                    else if (item.type === 'bonus_score') state.score += 50 * scoreMultiplier;
                    else if (item.type === 'bonus_slow') state.effects.slowUntil = Date.now() + 5000;
                    else if (item.type === 'bomb') state.score += 10 * scoreMultiplier; // Safe disposal
                    else if (item.type === 'boss_ship') { state.score = Math.max(0, state.score - 50); state.lives -= 1; }
                  }
                }
              }
              cursor.grabbedItemId = null;
            }
          }
        });
      } else {
        ['left', 'right'].forEach(h => {
          const cursor = state.cursors[h as 'left' | 'right'];
          cursor.isGrabbing = false;
          if (cursor.grabbedItemId !== null) {
            const item = state.items.find(i => i.id === cursor.grabbedItemId);
            if (item) {
              item.isGrabbed = false;
              item.grabbedBy = null;
            }
            cursor.grabbedItemId = null;
          }
        });
      }

      // Level Progression (Story Mode)
      if (state.mode === 'story') {
        if (state.level === 1 && state.score >= 100) state.level = 2;
        else if (state.level === 2 && state.score >= 250) state.level = 3;
        else if (state.level === 3 && state.score >= 500) {
          state.level = 4;
          state.boss.active = true;
          state.boss.hp = 100;
          state.boss.x = state.width / 2;
        }
      }

      // Game Over / Win Checks
      if (state.lives <= 0 && state.mode !== 'gameover') {
        state.mode = 'gameover';
        setFinalScore(state.score);
        setUiMode('gameover');
        return;
      }
      if (state.boss.active && state.boss.hp <= 0 && state.mode !== 'win') {
        state.mode = 'win';
        setFinalScore(state.score);
        setUiMode('win');
        return;
      }

      // Spawning Logic
      const now = Date.now();
      const isSlowed = now < state.effects.slowUntil;
      const baseSpawnRate = state.mode === 'endless' 
        ? Math.max(500, 2000 - Math.floor(state.score / 50) * 150) 
        : (state.level === 4 ? 1200 : 2000 - state.level * 300);
      const actualSpawnRate = isSlowed ? baseSpawnRate * 2 : baseSpawnRate;

      // Spawn Obstacles
      if (state.level >= 2 && state.obstacles.length < state.level + 1 && Math.random() < 0.02) {
        const isTop = Math.random() > 0.5;
        state.obstacles.push({
          id: now + 1,
          x: Math.random() > 0.5 ? -200 : state.width + 200,
          y: isTop ? state.height / 2 - 150 : state.height / 2 + 150,
          width: 200 + Math.random() * 150,
          height: 40,
          speed: (Math.random() * 3 + 2) * (isSlowed ? 0.5 : 1),
          direction: Math.random() > 0.5 ? 1 : -1
        });
      }

      if (now - state.lastSpawnTime > actualSpawnRate) {
        state.lastSpawnTime = now;
        
        const isLarge = Math.random() < 0.15; // 15% chance for large item

        if (state.boss.active) {
          // Boss Spawns
          const rand = Math.random();
          let type: ItemType = 'debris';
          let emoji = DEBRIS_EMOJIS[Math.floor(Math.random() * DEBRIS_EMOJIS.length)];
          
          if (rand < 0.25) { type = 'bomb'; emoji = BOMB_EMOJI; }
          else if (rand < 0.45) { type = 'boss_ship'; emoji = '🛸'; }
          else if (rand < 0.6) { type = 'satellite'; emoji = SATELLITE_EMOJIS[Math.floor(Math.random() * SATELLITE_EMOJIS.length)]; }
          
          state.items.push({
            id: now, type, emoji,
            x: state.boss.x, y: state.boss.y + 50,
            size: type === 'bomb' ? (isLarge ? 100 : 60) : (isLarge ? 80 : 40),
            speed: (Math.random() * 2 + 3) * (isSlowed ? 0.5 : 1),
            isGrabbed: false,
            grabbedBy: null,
            isLarge
          });
        } else {
          // Normal Spawns
          const rand = Math.random();
          let type: ItemType = 'debris';
          let emoji = DEBRIS_EMOJIS[Math.floor(Math.random() * DEBRIS_EMOJIS.length)];
          
          if (rand < 0.2) { type = 'satellite'; emoji = SATELLITE_EMOJIS[Math.floor(Math.random() * SATELLITE_EMOJIS.length)]; }
          else if (rand < 0.25) { type = 'bonus_score'; emoji = BONUS_SCORE_EMOJI; }
          else if (rand < 0.3) { type = 'bonus_slow'; emoji = BONUS_SLOW_EMOJI; }

          const levelSpeedMultiplier = state.mode === 'endless' ? 1 + state.score / 200 : state.level;
          
          state.items.push({
            id: now, type, emoji,
            x: Math.random() * (state.width - 100) + 50, y: -50,
            size: isLarge ? 80 : 40,
            speed: (Math.random() * 2 + levelSpeedMultiplier) * (isSlowed ? 0.5 : 1),
            isGrabbed: false,
            grabbedBy: null,
            isLarge
          });
        }
      }

      // Update and draw obstacles
      canvasCtx.save();
      for (let i = state.obstacles.length - 1; i >= 0; i--) {
        const obs = state.obstacles[i];
        obs.x += obs.speed * obs.direction;
        
        if ((obs.direction === 1 && obs.x > state.width + 300) || 
            (obs.direction === -1 && obs.x < -300)) {
          state.obstacles.splice(i, 1);
          continue;
        }
        
        // Draw obstacle as a laser beam or energy barrier
        const gradient = canvasCtx.createLinearGradient(obs.x, obs.y, obs.x, obs.y + obs.height);
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0)');
        gradient.addColorStop(0.5, 'rgba(255, 50, 0, 0.8)');
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
        
        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(obs.x, obs.y, obs.width, obs.height);
        
        // Core line
        canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        canvasCtx.fillRect(obs.x, obs.y + obs.height / 2 - 2, obs.width, 4);
      }
      canvasCtx.restore();

      // Update and draw items
      canvasCtx.textAlign = 'center';
      canvasCtx.textBaseline = 'middle';
      
      for (let i = state.items.length - 1; i >= 0; i--) {
        const item = state.items[i];
        
        if (item.grabbedBy === 'both') {
          item.x = (state.cursors.left.x + state.cursors.right.x) / 2;
          item.y = (state.cursors.left.y + state.cursors.right.y) / 2;
        } else if (item.grabbedBy === 'left' && !item.isLarge) {
          item.x = state.cursors.left.x;
          item.y = state.cursors.left.y;
        } else if (item.grabbedBy === 'right' && !item.isLarge) {
          item.x = state.cursors.right.x;
          item.y = state.cursors.right.y;
        } else if (item.grabbedBy === 'left' || item.grabbedBy === 'right') {
          // Large item grabbed by one hand - it stops falling but doesn't move with the hand
          // Just jiggle it a bit to show it's partially grabbed
          item.x += (Math.random() - 0.5) * 2;
        } else {
          item.y += item.speed;
          
          if (item.type === 'boss_ship') {
            const centerX = state.width / 2;
            item.x += (centerX - item.x) * 0.02; // Homing towards incinerator
          }
          
          // Obstacle collision
          for (const obs of state.obstacles) {
            if (item.x > obs.x && item.x < obs.x + obs.width &&
                item.y + item.size/2 > obs.y && item.y - item.size/2 < obs.y + obs.height) {
              item.y = obs.y - item.size/2; // Rest on obstacle
              item.x += obs.speed * obs.direction; // Move with obstacle
            }
          }
        }
        
        if (item.y > state.height + 50) {
          state.items.splice(i, 1);
          continue;
        }
        
        canvasCtx.font = `${item.size}px Arial`;
        canvasCtx.fillText(item.emoji, item.x, item.y);
        
        if (item.isLarge && item.grabbedBy !== 'both') {
          canvasCtx.strokeStyle = 'red';
          canvasCtx.lineWidth = 2;
          canvasCtx.strokeRect(item.x - item.size/2, item.y - item.size/2, item.size, item.size);
          canvasCtx.font = '12px Arial';
          canvasCtx.fillStyle = 'red';
          canvasCtx.fillText('Cần 2 tay!', item.x, item.y - item.size/2 - 10);
        }
      }

      // Boss Logic & Drawing
      if (state.boss.active) {
        state.boss.x += state.boss.speed * state.boss.direction * (isSlowed ? 0.5 : 1);
        if (state.boss.x < 100 || state.boss.x > state.width - 100) {
          state.boss.direction *= -1;
        }
        
        canvasCtx.font = '100px Arial';
        canvasCtx.fillText(BOSS_EMOJI, state.boss.x, state.boss.y);
        
        // Boss HP Bar
        const hpBarWidth = 150;
        canvasCtx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        canvasCtx.fillRect(state.boss.x - hpBarWidth/2, state.boss.y - 80, hpBarWidth, 15);
        canvasCtx.fillStyle = 'rgba(0, 255, 0, 0.9)';
        canvasCtx.fillRect(state.boss.x - hpBarWidth/2, state.boss.y - 80, (state.boss.hp / state.boss.maxHp) * hpBarWidth, 15);
        canvasCtx.strokeStyle = 'white';
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeRect(state.boss.x - hpBarWidth/2, state.boss.y - 80, hpBarWidth, 15);
      }

      // Draw Incinerator (Center)
      const incinCenterX = state.width / 2;
      const incinCenterY = state.height / 2;
      
      canvasCtx.save();
      
      // Outer glow
      const time = Date.now() / 200;
      const pulse = Math.sin(time) * 10;
      
      canvasCtx.beginPath();
      canvasCtx.arc(incinCenterX, incinCenterY, 90 + pulse, 0, Math.PI * 2);
      const grad = canvasCtx.createRadialGradient(incinCenterX, incinCenterY, 40, incinCenterX, incinCenterY, 100 + pulse);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      grad.addColorStop(0.2, 'rgba(255, 200, 0, 0.6)');
      grad.addColorStop(0.5, 'rgba(255, 50, 0, 0.4)');
      grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
      canvasCtx.fillStyle = grad;
      canvasCtx.fill();
      
      // Inner core
      canvasCtx.beginPath();
      canvasCtx.arc(incinCenterX, incinCenterY, 50, 0, Math.PI * 2);
      canvasCtx.fillStyle = 'rgba(255, 250, 200, 0.9)';
      canvasCtx.shadowColor = '#FF5500';
      canvasCtx.shadowBlur = 30;
      canvasCtx.fill();
      
      // Rotating ring
      canvasCtx.translate(incinCenterX, incinCenterY);
      canvasCtx.rotate(time / 5);
      canvasCtx.beginPath();
      canvasCtx.arc(0, 0, 70, 0, Math.PI * 1.5);
      canvasCtx.strokeStyle = 'rgba(255, 100, 0, 0.8)';
      canvasCtx.lineWidth = 6;
      canvasCtx.stroke();
      
      canvasCtx.rotate(Math.PI);
      canvasCtx.beginPath();
      canvasCtx.arc(0, 0, 85, 0, Math.PI);
      canvasCtx.strokeStyle = 'rgba(255, 50, 0, 0.5)';
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();
      
      canvasCtx.restore();
      
      canvasCtx.save();
      canvasCtx.fillStyle = '#FFF';
      canvasCtx.shadowColor = '#000';
      canvasCtx.shadowBlur = 5;
      canvasCtx.font = 'bold 18px Arial';
      canvasCtx.textAlign = 'center';
      canvasCtx.fillText('LÒ ĐỐT', incinCenterX, incinCenterY - 10);
      canvasCtx.fillText('PLASMA', incinCenterX, incinCenterY + 15);
      canvasCtx.restore();
      
      // Draw Cursors
      ['left', 'right'].forEach(h => {
        const cursor = state.cursors[h as 'left' | 'right'];
        if (cursor.isGrabbing) {
          canvasCtx.beginPath();
          canvasCtx.arc(cursor.x, cursor.y, 15, 0, Math.PI * 2);
          canvasCtx.fillStyle = h === 'left' ? 'rgba(0, 255, 0, 0.5)' : 'rgba(0, 0, 255, 0.5)';
          canvasCtx.fill();
        }
      });

      // Draw HUD on Canvas
      canvasCtx.save();
      canvasCtx.textAlign = 'left';
      canvasCtx.textBaseline = 'top';
      canvasCtx.fillStyle = 'white';
      canvasCtx.shadowColor = 'black';
      canvasCtx.shadowBlur = 4;
      
      canvasCtx.font = 'bold 32px monospace';
      canvasCtx.fillText(`Score: ${state.score}`, 30, 30);
      
      canvasCtx.font = '28px Arial';
      canvasCtx.fillText(`Lives: ${'❤️'.repeat(state.lives)}`, 30, 70);
      
      canvasCtx.font = 'bold 24px monospace';
      canvasCtx.fillStyle = '#60A5FA';
      if (state.mode === 'story') {
        canvasCtx.fillText(`Level: ${state.level === 4 ? 'BOSS FIGHT' : state.level}`, 30, 110);
      } else {
        canvasCtx.fillText(`Endless Mode`, 30, 110);
      }

      if (isSlowed) {
        canvasCtx.fillStyle = '#38BDF8';
        canvasCtx.fillText(`❄️ TIME SLOWED ❄️`, 30, 150);
      }
      canvasCtx.restore();
    });

    const camera = new window.Camera(videoElement, {
      onFrame: async () => {
        await hands.send({image: videoElement});
      },
      width: 1280,
      height: 720
    });
    
    camera.start();
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900 text-white font-sans">
      {/* Background stars */}
      <div className="absolute inset-0 z-0 opacity-50 pointer-events-none" 
           style={{
             backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
             backgroundSize: '50px 50px'
           }}>
      </div>

      {/* Menus & Overlays */}
      {uiMode === 'menu' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm p-8">
          <div className="max-w-2xl bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 w-full">
            <h1 className="text-4xl font-bold text-blue-400 mb-6 text-center">Kessler Syndrome AR</h1>
            
            <div className="space-y-4 text-slate-300 mb-8 leading-relaxed text-sm">
              <p>Dọn dẹp rác vũ trụ để cứu Trái Đất khỏi Hội chứng Kessler!</p>
              
              <div className="grid grid-cols-2 gap-4 mt-4 bg-slate-900 p-4 rounded-xl">
                <div>
                  <h3 className="font-semibold text-red-400 mb-1">Rác (Kéo vào lò)</h3>
                  <div className="text-2xl flex gap-2">🪨 🔩 🗑️</div>
                  <p className="text-xs text-slate-400 mt-1">+10 Điểm. Vật to cần 2 tay!</p>
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-400 mb-1">Vệ tinh (Tránh xa)</h3>
                  <div className="text-2xl flex gap-2">🛰️ 🚀</div>
                  <p className="text-xs text-slate-400 mt-1">-1 Mạng, -20 Điểm</p>
                </div>
                <div>
                  <h3 className="font-semibold text-yellow-400 mb-1">Vật phẩm (Kéo vào lò)</h3>
                  <div className="text-2xl flex gap-2">⭐ ⏱️</div>
                  <p className="text-xs text-slate-400 mt-1">+50 Điểm / Làm chậm</p>
                </div>
                <div>
                  <h3 className="font-semibold text-purple-400 mb-1">Boss (Ném bom)</h3>
                  <div className="text-2xl flex gap-2">👾 💣 🛸</div>
                  <p className="text-xs text-slate-400 mt-1">Ném bom vào Boss. Cản tàu 🛸 lao vào lò!</p>
                </div>
              </div>
            </div>
            
            <div className="flex gap-4">
              <button 
                onClick={() => initGame('story')}
                className="flex-1 py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all transform hover:scale-105 shadow-[0_0_20px_rgba(37,99,235,0.4)]"
              >
                Chơi Cốt Truyện
              </button>
              <button 
                onClick={() => initGame('endless')}
                className="flex-1 py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-all transform hover:scale-105 shadow-[0_0_20px_rgba(147,51,234,0.4)]"
              >
                Chơi Vô Tận
              </button>
            </div>
          </div>
        </div>
      )}

      {uiMode === 'gameover' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-900/90 backdrop-blur-md p-8">
          <div className="text-center">
            <h1 className="text-6xl font-bold text-white mb-4 drop-shadow-lg">GAME OVER</h1>
            <p className="text-2xl text-red-200 mb-8">Bạn đã hết mạng!</p>
            <p className="text-4xl font-mono text-yellow-400 mb-12">Score: {finalScore}</p>
            <button 
              onClick={() => setUiMode('menu')}
              className="px-8 py-4 bg-white text-red-900 font-bold rounded-xl text-xl transition-all hover:scale-105 shadow-xl"
            >
              Về Menu Chính
            </button>
          </div>
        </div>
      )}

      {uiMode === 'win' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-emerald-900/90 backdrop-blur-md p-8">
          <div className="text-center">
            <h1 className="text-6xl font-bold text-white mb-4 drop-shadow-lg">CHIẾN THẮNG!</h1>
            <p className="text-2xl text-emerald-200 mb-8">Bạn đã tiêu diệt Boss và cứu Trái Đất!</p>
            <p className="text-4xl font-mono text-yellow-400 mb-12">Score: {finalScore}</p>
            <button 
              onClick={() => setUiMode('menu')}
              className="px-8 py-4 bg-white text-emerald-900 font-bold rounded-xl text-xl transition-all hover:scale-105 shadow-xl"
            >
              Về Menu Chính
            </button>
          </div>
        </div>
      )}

      {/* Hidden video element for MediaPipe */}
      <video ref={videoRef} className="hidden" playsInline autoPlay></video>

      {/* Main Game Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 z-10 w-full h-full object-cover"></canvas>
    </div>
  );
}
