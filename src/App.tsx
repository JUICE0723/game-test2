/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, AlertTriangle, Loader2, Timer, Flag, CheckCircle2 } from 'lucide-react';
import { generateGameAssets } from './services/assetService';
import { sounds } from './services/soundService';

// --- Constants ---
const GRAVITY = 0.4;
const JUMP_FORCE = -10; // Slightly reduced for manual control
const MOVE_SPEED = 5;
const JETPACK_FORCE = -8;
const JETPACK_DURATION = 2000; // 2 seconds
const PLATFORM_WIDTH = 80;
const PLATFORM_HEIGHT = 15;
const GAME_WIDTH = 400;
const GAME_HEIGHT = 600;
const PLAYER_SIZE = 40;
const WIN_HEIGHT = 10000;

interface Platform {
  x: number;
  y: number;
  type: 'normal' | 'moving' | 'trap' | 'disappearing' | 'finish';
  direction?: number;
  visible?: boolean;
  hasFlower?: boolean;
  flowerTriggered?: boolean;
  flowerVisible?: boolean;
  hasJetpack?: boolean;
}

interface Crow {
  x: number;
  y: number;
  vx: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'loading' | 'start' | 'playing' | 'gameover' | 'win'>('loading');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [time, setTime] = useState(0);
  const [jetpackTime, setJetpackTime] = useState(0);
  const [assets, setAssets] = useState<{ 
    background: string | null; 
    character: HTMLImageElement | null; 
    flag: HTMLImageElement | null;
    crow: HTMLImageElement | null;
    flower: HTMLImageElement | null;
    jetpack: HTMLImageElement | null;
  }>({ background: null, character: null, flag: null, crow: null, flower: null, jetpack: null });
  
  // Game state refs
  const playerRef = useRef({ x: GAME_WIDTH / 2, y: GAME_HEIGHT - 100, vx: 0, vy: 0, isGrounded: false, hasJetpack: false });
  const platformsRef = useRef<Platform[]>([]);
  const crowsRef = useRef<Crow[]>([]);
  const scrollYRef = useRef(0);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const requestRef = useRef<number>(null);
  const timerRef = useRef<number>(null);
  const jetpackTimerRef = useRef<number>(null);

  // Background removal helper
  const removeBackground = (dataUrl: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Pick the background color from the top-left pixel
        const bgR = data[0];
        const bgG = data[1];
        const bgB = data[2];
        
        // Only remove if it's not white-ish (to protect the face)
        const isBgNotWhite = bgR < 240 || bgG < 240 || bgB < 240;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Check if pixel is close to the background color
          const isSimilarToBg = Math.abs(r - bgR) < 45 && Math.abs(g - bgG) < 45 && Math.abs(b - bgB) < 45;
          
          // Specifically target "lime green" (0, 255, 0) or magenta (255, 0, 255)
          const isLimeGreen = g > 150 && r < 120 && b < 120;
          const isMagenta = r > 150 && g < 120 && b > 150;

          if (isBgNotWhite && (isSimilarToBg || isLimeGreen || isMagenta)) {
            data[i + 3] = 0;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        const newImg = new Image();
        newImg.src = canvas.toDataURL();
        newImg.onload = () => resolve(newImg);
        newImg.onerror = () => reject(new Error("Failed to load processed image"));
      };
      img.onerror = () => reject(new Error("Failed to load source image"));
      img.src = dataUrl;
    });
  };

  // Load assets
  useEffect(() => {
    const load = async () => {
      try {
        const generated = await generateGameAssets();
        const [charImg, flagImg, crowImg, flowerImg, jetpackImg] = await Promise.all([
          generated.character ? removeBackground(generated.character) : Promise.resolve(null),
          generated.flag ? removeBackground(generated.flag) : Promise.resolve(null),
          generated.crow ? removeBackground(generated.crow) : Promise.resolve(null),
          generated.flower ? removeBackground(generated.flower) : Promise.resolve(null),
          generated.jetpack ? removeBackground(generated.jetpack) : Promise.resolve(null)
        ]);
        setAssets({ 
          background: generated.background, 
          character: charImg,
          flag: flagImg,
          crow: crowImg,
          flower: flowerImg,
          jetpack: jetpackImg
        });
        setGameState('start');
      } catch (err) {
        console.error("Failed to generate assets", err);
        setGameState('start');
      }
    };
    load();
  }, []);

  const initGame = () => {
    playerRef.current = { x: GAME_WIDTH / 2 - PLAYER_SIZE / 2, y: GAME_HEIGHT - 100, vx: 0, vy: 0, isGrounded: false, hasJetpack: false };
    scrollYRef.current = 0;
    setScore(0);
    setTime(0);
    setJetpackTime(0);
    crowsRef.current = [];
    
    const initialPlatforms: Platform[] = [];
    initialPlatforms.push({ x: GAME_WIDTH / 2 - PLATFORM_WIDTH / 2, y: GAME_HEIGHT - 50, type: 'normal' });
    
    for (let i = 1; i < 12; i++) {
      initialPlatforms.push(...generatePlatformsAtHeight(GAME_HEIGHT - i * 100));
    }
    platformsRef.current = initialPlatforms;

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setTime(t => t + 1);
    }, 1000);
  };

  const generatePlatformsAtHeight = (y: number): Platform[] => {
    const heightFromStart = scrollYRef.current + (GAME_HEIGHT - y);
    if (heightFromStart >= WIN_HEIGHT) {
      return [{ x: GAME_WIDTH / 2 - PLATFORM_WIDTH / 2, y, type: 'finish' }];
    }

    const platforms: Platform[] = [];
    const trapChance = Math.min(0.3, score / 400); 
    const count = Math.random() > 0.7 ? 2 : 1; 
    
    for (let i = 0; i < count; i++) {
      const types: Platform['type'][] = ['normal', 'moving', 'disappearing'];
      let type = types[Math.floor(Math.random() * types.length)];
      if (Math.random() < trapChance) type = 'trap';
      if (i === 0 && type === 'trap') type = 'normal';

      const hasFlower = type === 'normal' && Math.random() < 0.25;
      const hasJetpack = !hasFlower && Math.random() < 0.005; // 0.5% chance

      platforms.push({
        x: Math.random() * (GAME_WIDTH - PLATFORM_WIDTH),
        y: y,
        type: type,
        direction: Math.random() > 0.5 ? 1 : -1,
        visible: true,
        hasFlower,
        hasJetpack
      });
    }

    // Randomly spawn a crow
    if (Math.random() < 0.2) {
      crowsRef.current.push({
        x: Math.random() > 0.5 ? -50 : GAME_WIDTH + 50,
        y: y - 50,
        vx: (Math.random() * 2 + 1) * (Math.random() > 0.5 ? 1 : -1)
      });
    }

    return platforms;
  };

  const update = () => {
    const player = playerRef.current;
    const platforms = platformsRef.current;
    const crows = crowsRef.current;

    // Horizontal Movement
    if (keysRef.current['ArrowLeft'] || keysRef.current['a']) player.vx = -MOVE_SPEED;
    else if (keysRef.current['ArrowRight'] || keysRef.current['d']) player.vx = MOVE_SPEED;
    else player.vx *= 0.8;

    // Vertical Movement (Manual Jump / Jetpack)
    if (player.hasJetpack) {
      player.vy = JETPACK_FORCE;
    } else {
      if ((keysRef.current['ArrowUp'] || keysRef.current['w']) && player.isGrounded) {
        player.vy = JUMP_FORCE;
        player.isGrounded = false;
        sounds.playJump();
      }
      player.vy += GRAVITY;
    }

    player.x += player.vx;
    player.y += player.vy;

    // Screen wrapping
    if (player.x + PLAYER_SIZE < 0) player.x = GAME_WIDTH;
    if (player.x > GAME_WIDTH) player.x = -PLAYER_SIZE;

    // Platform collision
    const wasGrounded = player.isGrounded;
    player.isGrounded = false;
    if (player.vy >= 0) {
      platforms.forEach(p => {
        if (p.visible !== false &&
            player.x + PLAYER_SIZE * 0.7 > p.x && 
            player.x + PLAYER_SIZE * 0.3 < p.x + PLATFORM_WIDTH &&
            player.y + PLAYER_SIZE > p.y && 
            player.y + PLAYER_SIZE < p.y + PLATFORM_HEIGHT + player.vy) {
          
          if (p.type === 'trap' || (p.hasFlower && p.flowerVisible)) {
            sounds.playTrap();
            sounds.stopBGM();
            setGameState('gameover');
            if (timerRef.current) clearInterval(timerRef.current);
          } else if (p.type === 'finish') {
            sounds.playWin();
            sounds.stopBGM();
            setGameState('win');
            if (timerRef.current) clearInterval(timerRef.current);
          } else {
            if (p.hasJetpack) {
              p.hasJetpack = false;
              player.hasJetpack = true;
              setJetpackTime(JETPACK_DURATION / 1000);
              sounds.playJetpack();
              if (jetpackTimerRef.current) clearInterval(jetpackTimerRef.current);
              jetpackTimerRef.current = window.setInterval(() => {
                setJetpackTime(t => {
                  if (t <= 1) {
                    player.hasJetpack = false;
                    clearInterval(jetpackTimerRef.current!);
                    return 0;
                  }
                  return t - 1;
                });
              }, 1000);
            }
            
            // Only play landing sound if we weren't grounded in the previous frame
            if (!wasGrounded && player.vy > GRAVITY) {
              sounds.playLand();
            }
            
            player.vy = 0;
            player.y = p.y - PLAYER_SIZE;
            player.isGrounded = true;
            if (p.type === 'disappearing') p.visible = false;
            
            if (p.hasFlower && !p.flowerTriggered) {
              p.flowerTriggered = true;
              setTimeout(() => {
                p.flowerVisible = true;
              }, 100);
            }
          }
        }
      });
    }

    // Crow collision
    crows.forEach(c => {
      c.x += c.vx;
      if (player.x < c.x + 30 && player.x + PLAYER_SIZE > c.x &&
          player.y < c.y + 30 && player.y + PLAYER_SIZE > c.y) {
        sounds.playTrap();
        sounds.stopBGM();
        setGameState('gameover');
        if (timerRef.current) clearInterval(timerRef.current);
      }
    });

    // Camera follow & Score
    if (player.y < GAME_HEIGHT / 2) {
      const diff = GAME_HEIGHT / 2 - player.y;
      player.y = GAME_HEIGHT / 2;
      scrollYRef.current += diff;
      setScore(s => Math.max(s, Math.floor(scrollYRef.current / 100)));
      platforms.forEach(p => p.y += diff);
      crows.forEach(c => c.y += diff);
    }

    // Update moving platforms
    platforms.forEach(p => {
      if (p.type === 'moving') {
        p.x += (p.direction || 1) * 2;
        if (p.x <= 0 || p.x + PLATFORM_WIDTH >= GAME_WIDTH) p.direction = -(p.direction || 1);
      }
    });

    // Recycle platforms and crows
    if (platforms.length > 0 && platforms[0].y > GAME_HEIGHT + 100) {
      const lowestY = Math.min(...platforms.map(p => p.y));
      platformsRef.current = platforms.filter(p => p.y <= GAME_HEIGHT + 100);
      crowsRef.current = crows.filter(c => c.y <= GAME_HEIGHT + 100);
      if (platformsRef.current.length < 15 && !platformsRef.current.some(p => p.type === 'finish')) {
        platformsRef.current.push(...generatePlatformsAtHeight(lowestY - 100));
      }
    }

    // Game over
    if (player.y > GAME_HEIGHT) {
      sounds.playTrap();
      sounds.stopBGM();
      setGameState('gameover');
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    if (assets.background) {
      const img = new Image();
      img.src = assets.background;
      ctx.drawImage(img, 0, 0, GAME_WIDTH, GAME_HEIGHT);
    } else {
      ctx.fillStyle = '#1a2e1a';
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }

    platformsRef.current.forEach(p => {
      if (p.visible === false) return;
      if (p.type === 'finish') {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(p.x, p.y, PLATFORM_WIDTH, PLATFORM_HEIGHT);
        if (assets.flag) {
          ctx.drawImage(assets.flag, p.x + PLATFORM_WIDTH/2 - 20, p.y - 40, 40, 40);
        } else {
          // Fallback flag
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(p.x + PLATFORM_WIDTH/2 - 2, p.y - 40, 4, 40);
          ctx.fillRect(p.x + PLATFORM_WIDTH/2 + 2, p.y - 40, 20, 15);
        }
      } else {
        ctx.fillStyle = p.type === 'trap' ? '#ef4444' : p.type === 'moving' ? '#3b82f6' : p.type === 'disappearing' ? '#fbbf24' : '#10b981';
        ctx.beginPath();
        ctx.roundRect(p.x, p.y, PLATFORM_WIDTH, PLATFORM_HEIGHT, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.stroke();
        
        if (p.hasFlower && p.flowerVisible) {
          if (assets.flower) {
            ctx.drawImage(assets.flower, p.x + PLATFORM_WIDTH/2 - 15, p.y - 30, 30, 30);
          } else {
            // Fallback flower
            ctx.fillStyle = '#a855f7';
            ctx.beginPath();
            ctx.arc(p.x + PLATFORM_WIDTH/2, p.y - 10, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        
        if (p.hasJetpack) {
          if (assets.jetpack) {
            ctx.drawImage(assets.jetpack, p.x + PLATFORM_WIDTH/2 - 15, p.y - 30, 30, 30);
          } else {
            // Fallback jetpack
            ctx.fillStyle = '#f97316';
            ctx.fillRect(p.x + PLATFORM_WIDTH/2 - 10, p.y - 25, 20, 25);
          }
        }
      }
    });

    crowsRef.current.forEach(c => {
      if (assets.crow) {
        ctx.save();
        if (c.vx > 0) { ctx.scale(-1, 1); ctx.drawImage(assets.crow, -c.x - 30, c.y, 30, 30); }
        else { ctx.drawImage(assets.crow, c.x, c.y, 30, 30); }
        ctx.restore();
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(c.x, c.y, 30, 30);
      }
    });

    const player = playerRef.current;
    if (assets.character) {
      ctx.save();
      if (player.vx < 0) {
        ctx.scale(-1, 1);
        ctx.drawImage(assets.character, -player.x - PLAYER_SIZE, player.y, PLAYER_SIZE, PLAYER_SIZE);
      } else {
        ctx.drawImage(assets.character, player.x, player.y, PLAYER_SIZE, PLAYER_SIZE);
      }
      if (player.hasJetpack) {
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(player.x + PLAYER_SIZE/2, player.y + PLAYER_SIZE + 10, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      ctx.fillStyle = '#fde047';
      ctx.fillRect(player.x, player.y, PLAYER_SIZE, PLAYER_SIZE);
    }
  };

  const gameLoop = () => {
    if (gameState === 'playing') {
      update();
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) draw(ctx);
      }
      requestRef.current = requestAnimationFrame(gameLoop);
    }
  };

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(gameLoop);
    } else if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => keysRef.current[e.key] = true;
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current[e.key] = false;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const startGame = () => {
    initGame();
    sounds.playBGM();
    setGameState('playing');
  };

  useEffect(() => {
    if (score > highScore) setHighScore(score);
  }, [score]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 font-sans text-white overflow-hidden">
      <div className="relative w-full max-w-[400px] aspect-[2/3] bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl border border-zinc-800">
        
        <canvas
          ref={canvasRef}
          width={GAME_WIDTH}
          height={GAME_HEIGHT}
          className="w-full h-full block"
        />

        {/* HUD */}
        {gameState === 'playing' && (
          <div className="absolute top-4 left-4 right-4 flex flex-col gap-2 pointer-events-none">
            <div className="flex justify-between items-start">
              <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold block leading-none mb-1">Level</span>
                <div className="text-xl font-black text-white leading-none">{score} / 100</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2">
                  <Timer className="w-4 h-4 text-yellow-400" />
                  <div className="text-xl font-black text-white leading-none">{formatTime(time)}</div>
                </div>
                {jetpackTime > 0 && (
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-orange-500/80 backdrop-blur-md px-3 py-1 rounded-full border border-orange-400/50 flex items-center gap-2"
                  >
                    <span className="text-[10px] font-black uppercase">Jetpack</span>
                    <span className="text-sm font-black">{jetpackTime}s</span>
                  </motion.div>
                )}
              </div>
            </div>
            {/* Progress Bar */}
            <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
              <motion.div 
                className="h-full bg-yellow-400"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, score)}%` }}
              />
            </div>
          </div>
        )}

        <AnimatePresence>
          {gameState === 'loading' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-zinc-950 flex flex-col items-center justify-center gap-6"
            >
              <div className="relative">
                <Loader2 className="w-12 h-12 text-yellow-400 animate-spin" />
                <div className="absolute inset-0 blur-xl bg-yellow-400/20 animate-pulse" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold tracking-tight">正在生成像素世界...</h2>
                <p className="text-zinc-500 text-sm">正在為黃色方塊準備綠色背景、黑色方塊烏鴉與噴射背包</p>
              </div>
            </motion.div>
          )}

          {gameState === 'start' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center overflow-y-auto"
            >
              <div className="mb-6 relative">
                <div className="absolute -inset-4 blur-3xl bg-yellow-400/20 rounded-full" />
                <h1 className="text-4xl font-black tracking-tighter italic text-yellow-400 drop-shadow-lg">
                  YELLOW BLOCK<br />CLIMB
                </h1>
                <p className="mt-2 text-zinc-300 font-medium">目標：攀爬 100 層到達終點！</p>
              </div>

              {/* Rules Section */}
              <div className="w-full space-y-3 mb-8 text-left">
                <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest text-center mb-4">遊戲規則提醒</h3>
                
                <div className="grid gap-2">
                  <div className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/10">
                    <div className="w-4 h-4 bg-[#10b981] rounded-sm shrink-0" />
                    <div className="text-xs">
                      <span className="font-bold text-[#10b981]">普通平台 (綠色)</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/10">
                    <div className="flex gap-1 shrink-0">
                      <div className="w-4 h-4 bg-[#3b82f6] rounded-sm" />
                      <div className="w-4 h-4 bg-[#fbbf24] rounded-sm" />
                    </div>
                    <div className="text-xs">
                      <span className="font-bold text-[#3b82f6]">移動平台 (藍色)</span> / <span className="font-bold text-[#fbbf24]">消失平台 (黃色)</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/10">
                    <div className="flex gap-1 shrink-0">
                      <div className="w-4 h-4 bg-[#ef4444] rounded-sm" />
                      <div className="w-4 h-4 text-[10px] flex items-center justify-center">🐦</div>
                      <div className="w-4 h-4 text-[10px] flex items-center justify-center">🌸</div>
                    </div>
                    <div className="text-xs">
                      <span className="font-bold text-red-500">陷阱平台 (紅色)</span> / <span className="font-bold">烏鴉</span> / <span className="font-bold">毒花</span>：碰到都會導致失敗。
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/10">
                    <div className="w-4 h-4 bg-orange-500 rounded-sm shrink-0 flex items-center justify-center">🚩</div>
                    <div className="text-xs">
                      <span className="font-bold text-orange-400">終點</span>：到達 100 層並觸碰紅色旗幟即可獲勝！
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 w-full max-w-xs">
                <button
                  onClick={startGame}
                  className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-black py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-[0_4px_0_0_#ca8a04]"
                >
                  <Play className="fill-current" /> 開始挑戰
                </button>
                
                <div className="grid grid-cols-2 gap-4 text-[10px] text-zinc-400">
                  <div className="bg-white/5 p-2 rounded-lg border border-white/10">
                    <div className="font-bold text-white mb-1">操作</div>
                    方向鍵 (含 ↑/W 跳躍)
                  </div>
                  <div className="bg-white/5 p-2 rounded-lg border border-white/10">
                    <div className="font-bold text-white mb-1">終點</div>
                    100 層紅色旗幟
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === 'gameover' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute inset-0 z-40 bg-red-950/80 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center"
            >
              <AlertTriangle className="w-16 h-16 text-red-500 mb-4 animate-bounce" />
              <h2 className="text-4xl font-black tracking-tighter text-white mb-2">挑戰失敗</h2>
              
              <div className="bg-black/40 rounded-2xl p-6 w-full mb-8 border border-white/10">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-zinc-400 font-bold uppercase tracking-widest text-xs">到達層數</span>
                  <span className="text-3xl font-black text-white">{score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 font-bold uppercase tracking-widest text-xs">耗時</span>
                  <span className="text-3xl font-black text-white">{formatTime(time)}</span>
                </div>
              </div>

              <button
                onClick={startGame}
                className="w-full bg-white text-black font-black py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-[0_4px_0_0_#d1d5db]"
              >
                <RotateCcw /> 重新挑戰
              </button>
            </motion.div>
          )}

          {gameState === 'win' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 z-40 bg-green-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center"
            >
              <div className="relative mb-6">
                <CheckCircle2 className="w-24 h-24 text-green-400" />
                <motion.div 
                  className="absolute inset-0 bg-green-400 rounded-full blur-2xl opacity-20"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.2, 0.4, 0.2] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
              <h2 className="text-4xl font-black tracking-tighter text-white mb-2">成功登頂！</h2>
              <p className="text-green-200 mb-8 font-medium">你成功帶領黃色方塊到達了終點</p>
              
              <div className="bg-black/40 rounded-2xl p-6 w-full mb-8 border border-white/10">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-zinc-400 font-bold uppercase tracking-widest text-xs">總耗時</span>
                  <span className="text-3xl font-black text-white">{formatTime(time)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 font-bold uppercase tracking-widest text-xs">最高紀錄</span>
                  <span className="text-3xl font-black text-yellow-400">{highScore} 層</span>
                </div>
              </div>

              <button
                onClick={startGame}
                className="w-full bg-yellow-400 text-black font-black py-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-[0_4px_0_0_#ca8a04]"
              >
                <RotateCcw /> 再次挑戰
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute inset-0 pointer-events-none border-[12px] border-zinc-900/50 rounded-2xl" />
      </div>

      <div className="fixed inset-0 -z-10 opacity-20 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-yellow-500 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-green-500 rounded-full blur-[128px]" />
      </div>
    </div>
  );
}
