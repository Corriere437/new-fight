
import React, { useEffect, useRef, useState } from 'react';
import p5 from 'p5';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { PlayerState, Projectile, FloatingText, Landmark, Results } from '../types';

// --- Constants ---
const MAX_HP = 100;
const PUNCH_COOLDOWN = 400; // Reduced slightly as speed check is stricter
const PROJECTILE_SPEED = 15;
const SPECIAL_SPEED = 10; 
const EXTENSION_THRESHOLD = 0.8; // Standard extension threshold
const PUNCH_SPEED_THRESHOLD = 0.04; // Velocity threshold
const SHIELD_THRESHOLD = 0.25; 
const SPECIAL_CHARGE_TIME = 1500; 
const CHARGE_GRACE_PERIOD = 500; 
const SWORD_ACTIVATION_DIST = 0.15; 
const SWORD_HEIGHT_THRESHOLD = 0.5; 
const SWORD_SWING_THRESHOLD = 0.04; 
const SWORD_COOLDOWN = 800; 
const DAMAGE_STANDARD = 2;
const DAMAGE_SPECIAL = 10;
const DAMAGE_SPECIAL_BLOCK = 3;
const DAMAGE_SWORD = 3;
const DAMAGE_SWORD_BLOCK = 1; // Changed from 0 to 1

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const CombatGame: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); 
  const isMounted = useRef(true); 
  
  // Game State Refs
  const gameStateRef = useRef({
    leftPlayer: { 
      id: 'left', hp: MAX_HP, isAI: false, color: '#3b82f6', 
      lastPunchTime: 0, detected: false, isShielding: false, 
      isCharging: false, chargeStartTime: 0, chargeLevel: 0,
      hasSword: false, prevSwordY: 0, lastSwordFireTime: 0,
      lastPoseTime: 0,
      boundingBox: null,
      prevWrists: { left: {x:0, y:0}, right: {x:0, y:0} }
    } as PlayerState,
    rightPlayer: { 
      id: 'right', hp: MAX_HP, isAI: true, color: '#ef4444', 
      lastPunchTime: 0, detected: false, isShielding: false, 
      isCharging: false, chargeStartTime: 0, chargeLevel: 0,
      hasSword: false, prevSwordY: 0, lastSwordFireTime: 0,
      lastPoseTime: 0,
      boundingBox: null,
      prevWrists: { left: {x:0, y:0}, right: {x:0, y:0} }
    } as PlayerState,
    projectiles: [] as Projectile[],
    floatingTexts: [] as FloatingText[],
    poseResults: null as any, 
    virtualTargetY: 0.5,
    virtualTargetSpeed: 0.005,
    isGameOver: false
  });

  // React State for UI Overlay (HP Bars)
  const [hpLeft, setHpLeft] = useState(MAX_HP);
  const [hpRight, setHpRight] = useState(MAX_HP);
  const [playerCount, setPlayerCount] = useState(0);
  const [winner, setWinner] = useState<string | null>(null);

  const resetGame = () => {
    gameStateRef.current.leftPlayer.hp = MAX_HP;
    gameStateRef.current.rightPlayer.hp = MAX_HP;
    gameStateRef.current.leftPlayer.isCharging = false;
    gameStateRef.current.leftPlayer.chargeLevel = 0;
    gameStateRef.current.rightPlayer.isCharging = false;
    gameStateRef.current.rightPlayer.chargeLevel = 0;
    gameStateRef.current.projectiles = [];
    gameStateRef.current.floatingTexts = [];
    gameStateRef.current.isGameOver = false;
    setHpLeft(MAX_HP);
    setHpRight(MAX_HP);
    setWinner(null);
  };

  useEffect(() => {
    isMounted.current = true;
    let myP5Instance: p5 | null = null;
    let poseLandmarker: PoseLandmarker | null = null;
    let animationFrameId: number;

    // Initialize Offscreen Canvas for Mask
    if (!maskCanvasRef.current) {
        maskCanvasRef.current = document.createElement('canvas');
        maskCanvasRef.current.width = CANVAS_WIDTH;
        maskCanvasRef.current.height = CANVAS_HEIGHT;
    }

    const init = async () => {
        // --- MediaPipe Tasks Vision Setup ---
        try {
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
            );
            
            poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numPoses: 2, 
                minPoseDetectionConfidence: 0.5,
                minPosePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                outputSegmentationMasks: true,
            });
        } catch (error) {
            console.error("Failed to load MediaPipe PoseLandmarker", error);
            return;
        }

        // --- Camera Setup (Native) ---
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && videoRef.current) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { 
                width: { ideal: CANVAS_WIDTH }, 
                height: { ideal: CANVAS_HEIGHT },
                facingMode: 'user'
              }
            });
            
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              await videoRef.current.play();

              // Start Processing Loop
              let lastVideoTime = -1;
              const processVideoFrame = async () => {
                if (!isMounted.current) return;
                
                if (videoRef.current && poseLandmarker && videoRef.current.readyState >= 2) {
                    let startTimeMs = performance.now();
                    if (videoRef.current.currentTime !== lastVideoTime) {
                        lastVideoTime = videoRef.current.currentTime;
                        const results = poseLandmarker.detectForVideo(videoRef.current, startTimeMs);
                        
                        // 1. Store Logic Data
                        gameStateRef.current.poseResults = results;

                        // 2. Persist Segmentation Masks
                        if (results.segmentationMasks) {
                            if (maskCanvasRef.current) {
                                const ctx = maskCanvasRef.current.getContext('2d');
                                if (ctx) {
                                    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                                    results.segmentationMasks.forEach(mask => {
                                        try {
                                             ctx.drawImage(mask, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
                                        } catch(e) {
                                        } finally {
                                            if (mask && typeof (mask as any).close === 'function') {
                                                (mask as any).close();
                                            }
                                        }
                                    });
                                } else {
                                    results.segmentationMasks.forEach(mask => {
                                        if (mask && typeof (mask as any).close === 'function') {
                                            (mask as any).close();
                                        }
                                    });
                                }
                            } else {
                                results.segmentationMasks.forEach(mask => {
                                    if (mask && typeof (mask as any).close === 'function') {
                                        (mask as any).close();
                                    }
                                });
                            }
                        }
                    }
                }
                
                if (isMounted.current) {
                   animationFrameId = requestAnimationFrame(processVideoFrame);
                }
              };
              processVideoFrame();
            }
          } catch (err) {
            console.error("Error accessing webcam:", err);
          }
        }

        // --- P5.js Setup ---
        const sketch = (p: p5) => {
          
          p.setup = () => {
            p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
            p.frameRate(60);
          };

          p.draw = () => {
            p.clear();
            p.background(20, 20, 30, 200); 

            const state = gameStateRef.current;

            if (state.isGameOver) {
               drawBackground(p, videoRef.current);
               drawGameOver(p, state.leftPlayer.hp <= 0 ? "RIGHT WINS" : "LEFT WINS");
               if (p.frameCount % 10 === 0) {
                   setWinner(state.leftPlayer.hp <= 0 ? "Right Player" : "Left Player");
               }
               return; 
            }

            const results = state.poseResults;

            drawBackground(p, videoRef.current);

            let detectedLeft = false;
            let detectedRight = false;
            
            if (results && results.landmarks && results.landmarks.length > 0) {
              const poses = results.landmarks.map((l: any, index: number) => ({
                 landmarks: l,
                 centerX: (l[11].x + l[12].x) / 2 
              }));

              poses.forEach((pose: any) => {
                  const isPlayer1 = pose.centerX > 0.5; 

                  if (isPlayer1) {
                      detectedLeft = true;
                      processPlayer(p, 'left', pose.landmarks, state);
                  } else {
                      detectedRight = true;
                      processPlayer(p, 'right', pose.landmarks, state);
                  }
              });
            }

            if (!detectedLeft) {
                state.leftPlayer.detected = false;
                state.leftPlayer.boundingBox = null;
                resetPlayerAction(state.leftPlayer);
            }
            if (!detectedRight) {
                if (!state.rightPlayer.isAI) {
                     state.rightPlayer.detected = false;
                     state.rightPlayer.boundingBox = null;
                     resetPlayerAction(state.rightPlayer);
                }
            } else {
                state.rightPlayer.isAI = false;
            }

            if (detectedLeft && !detectedRight) {
                 state.rightPlayer.isAI = true;
            }

            if (p.frameCount % 15 === 0) {
               setHpLeft(state.leftPlayer.hp);
               setHpRight(state.rightPlayer.hp);
               setPlayerCount(state.rightPlayer.isAI ? 1 : 2);
            }

            if (state.rightPlayer.isAI) {
              updateAI(p, state);
              drawAI(p, state);
            }

            updateProjectiles(p, state);
            drawProjectiles(p, state);

            updateFloatingText(p, state);
            drawFloatingText(p, state);

            if (state.leftPlayer.hp <= 0 || state.rightPlayer.hp <= 0) {
                state.isGameOver = true;
            }
          };

          const drawBackground = (p: p5, video: HTMLVideoElement | null) => {
             if (video && video.readyState >= 2) {
                 p.push();
                 p.translate(p.width, 0);
                 p.scale(-1, 1);
                 p.tint(255, 50); 
                 
                 try {
                    p.image(video as unknown as p5.Image, 0, 0, p.width, p.height);
                 } catch (e) {}
                 
                 if (maskCanvasRef.current) {
                    (p.drawingContext as CanvasRenderingContext2D).globalCompositeOperation = 'screen';
                    p.tint(100, 200, 255, 120); 
                    try {
                        p.image(maskCanvasRef.current as unknown as p5.Image, 0, 0, p.width, p.height);
                    } catch (e) {}
                 }
                 p.pop();
            }
          }
        };

        myP5Instance = new p5(sketch, containerRef.current || undefined);
    };

    init();

    return () => {
      isMounted.current = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (myP5Instance) myP5Instance.remove();
      
      if (videoRef.current && videoRef.current.srcObject) {
         const stream = videoRef.current.srcObject as MediaStream;
         stream.getTracks().forEach(track => track.stop());
      }
      if (poseLandmarker) {
          poseLandmarker.close();
      }
    };
  }, []);

  return (
    <div className="relative w-full max-w-[1280px] aspect-video bg-black shadow-2xl rounded-xl overflow-hidden border border-slate-700">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <video ref={videoRef} className="hidden" playsInline muted />

      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-6">
        <div className="flex justify-between items-start w-full gap-8">
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span className="text-blue-400 font-bold font-mono tracking-widest text-xl shadow-black drop-shadow-md">PLAYER 1</span>
              <span className="text-white font-mono drop-shadow-md">{Math.round(Math.max(0, hpLeft))}%</span>
            </div>
            <div className="h-6 bg-slate-900/80 skew-x-[-15deg] border border-blue-500/50 backdrop-blur-sm">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.max(0, hpLeft)}%` }}
              />
            </div>
          </div>

          <div className="mt-2 text-3xl font-black italic text-white/20 tracking-wider">VS</div>

          <div className="flex-1">
             <div className="flex justify-between mb-1">
              <span className="text-white font-mono drop-shadow-md">{Math.round(Math.max(0, hpRight))}%</span>
              <span className="text-red-400 font-bold font-mono tracking-widest text-xl shadow-black drop-shadow-md">
                {playerCount === 1 ? 'TARGET' : 'PLAYER 2'}
              </span>
            </div>
            <div className="h-6 bg-slate-900/80 skew-x-[15deg] border border-red-500/50 backdrop-blur-sm">
               <div 
                className="h-full bg-gradient-to-l from-red-600 to-orange-400 float-right transition-all duration-300 ease-out"
                style={{ width: `${Math.max(0, hpRight)}%` }}
              />
            </div>
          </div>
        </div>
        
        {winner && (
            <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto">
                <div className="bg-black/60 backdrop-blur-md p-8 rounded-2xl border border-white/20 text-center flex flex-col items-center">
                    <h2 className="text-6xl font-black text-white italic drop-shadow-2xl mb-4">{winner.toUpperCase()} WINS!</h2>
                    {/* The main Play Again button can remain here for the winner screen, or be removed if you prefer just the bottom one. 
                        I'll leave it as a primary CTA for the game over state. */}
                    <button 
                        onClick={resetGame}
                        className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold text-xl rounded-full transition-all transform hover:scale-105 shadow-lg shadow-blue-900/50"
                    >
                        PLAY AGAIN
                    </button>
                </div>
            </div>
        )}

        <div className="flex flex-col items-center gap-3 pb-2">
            <button 
                onClick={resetGame}
                className="pointer-events-auto px-8 py-2 bg-slate-800/50 hover:bg-red-900/60 text-white/80 hover:text-white font-mono text-sm border border-white/10 hover:border-red-500/50 rounded-full backdrop-blur-md transition-all duration-200 hover:shadow-[0_0_15px_rgba(255,0,0,0.3)]"
            >
                RESTART MATCH
            </button>
            <p className="text-cyan-200/80 text-xs font-mono bg-black/40 inline-block px-4 py-1 rounded-full backdrop-blur-sm border border-cyan-900/20 pointer-events-none">
               {playerCount === 1 ? 'PRACTICE MODE - SINGLE PLAYER' : 'DUEL MODE - TWO PLAYERS'}
            </p>
        </div>
      </div>
    </div>
  );
};

// --- Logic Processors ---

function processPlayer(p: p5, side: 'left' | 'right', landmarks: any[], state: any) {
    const player = side === 'left' ? state.leftPlayer : state.rightPlayer;
    player.detected = true;
    
    // Update Hitbox
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for(const lm of landmarks) {
        if(lm.x < minX) minX = lm.x;
        if(lm.x > maxX) maxX = lm.x;
        if(lm.y < minY) minY = lm.y;
        if(lm.y > maxY) maxY = lm.y;
    }

    player.boundingBox = {
        minX: (1 - maxX) * p.width, // Mirror
        maxX: (1 - minX) * p.width,
        minY: minY * p.height,
        maxY: maxY * p.height
    };

    // Detection Pipeline
    detectShield(p, side, landmarks, state);
    detectSpecial(p, side, landmarks, state);
    detectSword(p, side, landmarks, state);

    if (!player.isShielding && !player.isCharging && !player.hasSword) {
        detectPunch(p, side, landmarks, state);
    }

    drawSkeleton(p, landmarks, player.color, player);
}


// --- Helpers ---

function getDist(a: Landmark, b: Landmark): number {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

function resetPlayerAction(player: PlayerState) {
    player.isShielding = false;
    player.isCharging = false;
    player.chargeLevel = 0;
    player.hasSword = false;
}

function detectShield(p: p5, side: 'left' | 'right', landmarks: any[], state: any) {
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  
  const distLeftToLeftShoulder = getDist(leftWrist, leftShoulder);
  const distLeftToRightShoulder = getDist(leftWrist, rightShoulder);
  const distRightToRightShoulder = getDist(rightWrist, rightShoulder);
  const distRightToLeftShoulder = getDist(rightWrist, leftShoulder);

  const isLeftHandUp = distLeftToLeftShoulder < SHIELD_THRESHOLD || distLeftToRightShoulder < SHIELD_THRESHOLD;
  const isRightHandUp = distRightToRightShoulder < SHIELD_THRESHOLD || distRightToLeftShoulder < SHIELD_THRESHOLD;

  const playerState = side === 'left' ? state.leftPlayer : state.rightPlayer;

  if (isLeftHandUp && isRightHandUp) {
      playerState.isShielding = true;
      playerState.hasSword = false; 
  } else {
      playerState.isShielding = false;
  }
}

function detectSword(p: p5, side: 'left' | 'right', landmarks: any[], state: any) {
    const playerState = side === 'left' ? state.leftPlayer : state.rightPlayer;
    if (playerState.isShielding || playerState.isCharging) {
        playerState.hasSword = false;
        return;
    }

    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    
    const currentHandY = (leftWrist.y + rightWrist.y) / 2;
    const handDist = getDist(leftWrist, rightWrist);
    
    const isInStance = handDist < SWORD_ACTIVATION_DIST && currentHandY > SWORD_HEIGHT_THRESHOLD;

    if (isInStance) {
        playerState.hasSword = true;
        
        if (playerState.prevSwordY !== 0) {
            const dy = currentHandY - playerState.prevSwordY;
            const now = Date.now();
            
            if (Math.abs(dy) > SWORD_SWING_THRESHOLD && (now - playerState.lastSwordFireTime > SWORD_COOLDOWN)) {
                playerState.lastSwordFireTime = now;
                
                const centerX = (leftWrist.x + rightWrist.x) / 2;
                const startX = (1 - centerX) * p.width; 
                const startY = currentHandY * p.height;
                const dir = side === 'left' ? 1 : -1; 
                
                state.projectiles.push({
                     id: Math.random().toString(36),
                     type: 'sword',
                     damage: DAMAGE_SWORD,
                     blockDamage: DAMAGE_SWORD_BLOCK,
                     x: startX,
                     y: startY,
                     vx: dir * PROJECTILE_SPEED * 1.2, 
                     vy: 0,
                     owner: side,
                     active: true
                });
            }
        }
    } else {
        playerState.hasSword = false;
    }
    
    playerState.prevSwordY = currentHandY;
}

function detectSpecial(p: p5, side: 'left' | 'right', landmarks: any[], state: any) {
  const playerState = side === 'left' ? state.leftPlayer : state.rightPlayer;
  
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];

  const leftHandUp = leftWrist.y < leftShoulder.y;
  const leftHandDown = leftWrist.y > leftShoulder.y;
  const rightHandUp = rightWrist.y < rightShoulder.y;
  const rightHandDown = rightWrist.y > rightShoulder.y;

  const isSpecialPoseRaw = (leftHandUp && rightHandDown) || (rightHandUp && leftHandDown);
  const isHoldingPose = isSpecialPoseRaw && !playerState.isShielding && !playerState.hasSword;
  
  const now = Date.now();

  if (isHoldingPose) {
      if (!playerState.isCharging) {
          playerState.isCharging = true;
          playerState.chargeStartTime = now;
      }
      playerState.lastPoseTime = now;
      const elapsed = now - playerState.chargeStartTime;
      playerState.chargeLevel = Math.min(1.0, elapsed / SPECIAL_CHARGE_TIME);

  } else {
      if (playerState.isCharging) {
          if (playerState.chargeLevel >= 1.0) {
              fireSpecial(p, side, landmarks, state);
              playerState.isCharging = false;
              playerState.chargeLevel = 0;
          } else {
              if (now - playerState.lastPoseTime > CHARGE_GRACE_PERIOD) {
                  playerState.isCharging = false;
                  playerState.chargeLevel = 0;
              }
          }
      }
  }
}

function fireSpecial(p: p5, side: 'left' | 'right', landmarks: any[], state: any) {
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const centerX = (leftWrist.x + rightWrist.x) / 2;
  const centerY = (leftWrist.y + rightWrist.y) / 2;
  const startX = (1 - centerX) * p.width; 
  const startY = centerY * p.height;
  const dir = side === 'left' ? 1 : -1; 

  state.projectiles.push({
     id: Math.random().toString(36),
     type: 'special',
     damage: DAMAGE_SPECIAL,
     blockDamage: DAMAGE_SPECIAL_BLOCK,
     x: startX,
     y: startY,
     vx: dir * SPECIAL_SPEED,
     vy: 0,
     owner: side,
     active: true
  });
}

function detectPunch(p: p5, side: 'left' | 'right', landmarks: any[], state: any) {
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  
  // Normalize scale based on shoulder width or torso height (whichever is larger to avoid side-view zero width issue)
  const shoulderDist = getDist(leftShoulder, rightShoulder);
  const torsoHeight = getDist(leftShoulder, leftHip);
  const scale = Math.max(shoulderDist, torsoHeight, 0.1); 
  
  checkHand(p, side, 'left', leftWrist, leftShoulder, leftHip, scale, state);
  checkHand(p, side, 'right', rightWrist, rightShoulder, rightHip, scale, state);
}

function checkHand(p: p5, side: 'left' | 'right', handSide: 'left'|'right', wrist: Landmark, shoulder: Landmark, hip: Landmark, scale: number, state: any) {
  const playerState = side === 'left' ? state.leftPlayer : state.rightPlayer;
  
  if (playerState.isShielding || playerState.isCharging || playerState.hasSword) return;

  const now = Date.now();
  if (now - playerState.lastPunchTime < PUNCH_COOLDOWN) return;

  // --- HEIGHT CHECK (Chest Level) ---
  const chestHighBound = shoulder.y - 0.1; 
  const chestLowBound = hip.y - 0.1;       
  
  if (wrist.y < chestHighBound || wrist.y > chestLowBound) {
      return; 
  }

  // --- VELOCITY CHECK ---
  // Calculate relative position to shoulder
  const relX = wrist.x - shoulder.x;
  const relY = wrist.y - shoulder.y;

  const prevWrist = playerState.prevWrists[handSide];
  const dx = relX - prevWrist.x;
  const dy = relY - prevWrist.y;
  const speed = Math.sqrt(dx*dx + dy*dy); // Speed in normalized units

  // Update history
  playerState.prevWrists[handSide] = { x: relX, y: relY };

  // --- EXTENSION CHECK ---
  const ext = getDist(wrist, shoulder);
  const extensionRatio = ext / scale;
  
  // COMBINED CONDITION: Must be moving fast AND be somewhat extended
  if (speed > PUNCH_SPEED_THRESHOLD && extensionRatio > EXTENSION_THRESHOLD) {
     playerState.lastPunchTime = now;
     
     const startX = (1 - wrist.x) * p.width; 
     const startY = wrist.y * p.height;
     const dir = side === 'left' ? 1 : -1; 
     
     state.projectiles.push({
       id: Math.random().toString(36),
       type: 'standard',
       damage: DAMAGE_STANDARD,
       blockDamage: 0, // Changed: Blocked punches deal 0 damage
       x: startX,
       y: startY,
       vx: dir * PROJECTILE_SPEED,
       vy: 0,
       owner: side,
       active: true
     });
  }
}

function drawSkeleton(p: p5, landmarks: any[], color: string, playerState: PlayerState) {
  p.push();
  p.translate(p.width, 0);
  p.scale(-1, 1);
  
  // Draw Shield
  if (playerState.isShielding && playerState.boundingBox) {
      const midHipX = (landmarks[23].x + landmarks[24].x) / 2;
      const midHipY = (landmarks[23].y + landmarks[24].y) / 2;
      const midShoulderX = (landmarks[11].x + landmarks[12].x) / 2;
      const midShoulderY = (landmarks[11].y + landmarks[12].y) / 2;
      
      const centerX = (midHipX + midShoulderX) / 2 * p.width;
      const centerY = (midHipY + midShoulderY) / 2 * p.height;
      
      p.push();
      p.translate(centerX, centerY);
      
      (p.drawingContext as CanvasRenderingContext2D).shadowBlur = 30;
      (p.drawingContext as CanvasRenderingContext2D).shadowColor = '#FFD700';
      p.fill(255, 215, 0, 80); 
      p.stroke(255, 255, 200, 200);
      p.strokeWeight(4);
      p.circle(0, 0, 300); 
      
      p.noFill();
      p.stroke(255, 215, 0);
      p.strokeWeight(2);
      p.circle(0, 0, 250);
      p.pop();
  }

  // Draw Sword
  if (playerState.hasSword) {
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      const cx = (leftWrist.x + rightWrist.x) / 2 * p.width;
      const cy = (leftWrist.y + rightWrist.y) / 2 * p.height;
      
      p.push();
      p.translate(cx, cy);
      
      const isLeft = playerState.id === 'left';
      const swordColor = isLeft ? '#00FFFF' : '#FF4500';
      
      (p.drawingContext as CanvasRenderingContext2D).shadowBlur = 20;
      (p.drawingContext as CanvasRenderingContext2D).shadowColor = swordColor;
      
      p.stroke(swordColor);
      p.strokeWeight(8);
      p.line(0, 0, 0, -150); 
      
      p.stroke(255);
      p.strokeWeight(3);
      p.line(0, 0, 0, -140); 
      
      p.stroke(150);
      p.strokeWeight(10);
      p.line(0, 10, 0, 30);
      p.pop();
  }

  // Draw Charging Effect
  if (playerState.isCharging) {
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      const cx = (leftWrist.x + rightWrist.x) / 2 * p.width;
      const cy = (leftWrist.y + rightWrist.y) / 2 * p.height;
      
      const baseSize = 30 + (playerState.chargeLevel * 90); 
      const pulse = Math.sin(p.frameCount * 0.4) * 10;
      const finalSize = baseSize + pulse;

      p.push();
      p.translate(cx, cy);
      p.noStroke();
      
      const isLeft = playerState.id === 'left';
      const colorStart = isLeft ? '#00FFFF' : '#FFA500'; 
      const colorEnd = isLeft ? '#FF00FF' : '#FF0000';   
      const chargeColor = playerState.chargeLevel >= 1.0 ? colorEnd : colorStart;
      
      (p.drawingContext as CanvasRenderingContext2D).shadowBlur = 40 * playerState.chargeLevel;
      (p.drawingContext as CanvasRenderingContext2D).shadowColor = chargeColor;
      
      p.fill(chargeColor + '88'); 
      p.circle(0, 0, finalSize);
      
      p.fill(255);
      p.circle(0, 0, finalSize * 0.5);

      if (playerState.chargeLevel < 1.0) {
          p.noFill();
          p.stroke(255);
          p.strokeWeight(5);
          p.arc(0, 0, finalSize + 20, finalSize + 20, 0, p.TWO_PI * playerState.chargeLevel);
      } else {
          p.noFill();
          p.stroke(255, 255, 0);
          p.strokeWeight(8);
          p.circle(0, 0, finalSize + 30);
      }

      p.pop();
  }

  p.stroke(color);
  p.strokeWeight(3);
  p.noFill();
  
  const connections = [
    [11, 13], [13, 15], 
    [12, 14], [14, 16], 
    [11, 12], [23, 24], 
    [11, 23], [12, 24]  
  ];

  connections.forEach(([i, j]) => {
    const p1 = landmarks[i];
    const p2 = landmarks[j];
    if (p1 && p2) {
      p.line(p1.x * p.width, p1.y * p.height, p2.x * p.width, p2.y * p.height);
    }
  });
  
  p.noStroke();
  p.fill(color);
  [15, 16].forEach(idx => {
    const lm = landmarks[idx];
    if(lm) {
       p.circle(lm.x * p.width, lm.y * p.height, 25);
       p.noFill();
       p.stroke(color);
       p.strokeWeight(1);
       p.circle(lm.x * p.width, lm.y * p.height, 35);
       p.noStroke();
       p.fill(color);
    }
  });

  p.pop();
}

function updateAI(p: p5, state: any) {
  state.virtualTargetY += state.virtualTargetSpeed;
  if (state.virtualTargetY > 0.7 || state.virtualTargetY < 0.3) {
    state.virtualTargetSpeed *= -1;
  }
  
  const xPos = p.width * 0.85;
  const yPos = state.virtualTargetY * p.height;
  const size = 120;
  
  state.rightPlayer.boundingBox = {
    minX: xPos - size/2,
    maxX: xPos + size/2,
    minY: yPos - size/2,
    maxY: yPos + size/2
  };
}

function drawAI(p: p5, state: any) {
  const { boundingBox } = state.rightPlayer;
  if (!boundingBox) return;
  
  const cx = (boundingBox.minX + boundingBox.maxX) / 2;
  const cy = (boundingBox.minY + boundingBox.maxY) / 2;
  
  p.push();
  p.translate(cx, cy);
  const rot = p.frameCount * 0.02;
  p.rotate(rot);
  
  p.noFill();
  p.stroke(255, 50, 50);
  p.strokeWeight(3);
  p.rectMode(p.CENTER);
  p.rect(0, 0, 100, 100);
  
  p.rotate(-rot * 2);
  p.stroke(255, 100, 100);
  p.rect(0, 0, 70, 70);
  
  p.resetMatrix();
  p.translate(cx, cy);
  p.fill(255, 0, 0, 150 + Math.sin(p.frameCount * 0.1) * 50);
  p.noStroke();
  p.circle(0, 0, 30);
  p.pop();
}

function updateProjectiles(p: p5, state: any) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    proj.x += proj.vx;
    proj.y += proj.vy;

    if (proj.x < -100 || proj.x > p.width + 100) {
      state.projectiles.splice(i, 1);
      continue;
    }

    const target = proj.owner === 'left' ? state.rightPlayer : state.leftPlayer;
    if (target.boundingBox) {
      const bbox = target.boundingBox;
      const hitPadding = proj.type === 'special' ? 100 : 20;

      if (proj.x > bbox.minX - hitPadding && proj.x < bbox.maxX + hitPadding && 
          proj.y > bbox.minY - hitPadding && proj.y < bbox.maxY + hitPadding) {
        
        let actualDamage = proj.damage;
        let color = '#ff2222';
        let hitText = `-${Math.round(actualDamage)}`;

        if (target.isShielding) {
            actualDamage = proj.blockDamage;
            color = '#FFD700'; 
            hitText = actualDamage === 0 ? "Blocked!" : `Block! -${Math.round(actualDamage)}`;
        }

        if (actualDamage > 0) {
            target.hp -= actualDamage;
        }
        
        state.projectiles.splice(i, 1);
        
        state.floatingTexts.push({
          id: Math.random().toString(),
          x: proj.x,
          y: proj.y,
          text: hitText,
          color: color,
          life: 40,
          maxLife: 40,
          vy: -3
        });
        
        continue;
      }
    }
  }
}

function drawProjectiles(p: p5, state: any) {
  p.push();
  for (const proj of state.projectiles) {
    const isLeft = proj.owner === 'left';

    if (proj.type === 'special') {
        (p.drawingContext as CanvasRenderingContext2D).shadowBlur = 60;
        (p.drawingContext as CanvasRenderingContext2D).shadowColor = isLeft ? '#FF00FF' : '#FF4500';
        
        p.fill(255);
        p.noStroke();
        p.circle(proj.x, proj.y, 100); 

        if (isLeft) {
            p.fill(200, 0, 255, 120); 
        } else {
            p.fill(255, 69, 0, 120); 
        }
        p.circle(proj.x, proj.y, 220);

        p.noFill();
        p.stroke(255, 150);
        p.strokeWeight(6);
        p.beginShape();
        for(let i=0; i<8; i++) {
            const tx = proj.x - (proj.vx * i * 6);
            const ty = proj.y + Math.sin(p.frameCount * 0.4 + i) * 30;
            p.vertex(tx, ty);
        }
        p.endShape();

    } else if (proj.type === 'sword') {
        (p.drawingContext as CanvasRenderingContext2D).shadowBlur = 20;
        const beamColor = isLeft ? '#00FFFF' : '#FF4500';
        (p.drawingContext as CanvasRenderingContext2D).shadowColor = beamColor;

        p.push();
        p.translate(proj.x, proj.y);
        
        const dir = proj.vx > 0 ? 1 : -1; 
        p.scale(dir, 1);

        p.noFill();
        p.stroke(beamColor);
        p.strokeWeight(4);
        p.arc(0, 0, 40, 100, -p.PI / 2, p.PI / 2); 
        
        p.stroke(255);
        p.strokeWeight(2);
        p.arc(-5, 0, 40, 90, -p.PI / 2, p.PI / 2); 

        p.pop();

    } else {
        (p.drawingContext as CanvasRenderingContext2D).shadowBlur = 20;
        (p.drawingContext as CanvasRenderingContext2D).shadowColor = isLeft ? '#00ffff' : '#ff3300';
        
        p.fill(255, 255, 255, 200);
        p.noStroke();
        p.circle(proj.x, proj.y, 40);
        
        p.fill(255);
        p.circle(proj.x, proj.y, 20);
        
        p.stroke(255, 100);
        p.strokeWeight(4);
        const tailLen = 60;
        p.line(proj.x, proj.y, proj.x - (proj.vx > 0 ? tailLen : -tailLen), proj.y);
    }
  }
  p.pop();
}

function updateFloatingText(p: p5, state: any) {
  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.y += ft.vy;
    ft.life--;
    if (ft.life <= 0) {
      state.floatingTexts.splice(i, 1);
    }
  }
}

function drawFloatingText(p: p5, state: any) {
  p.push();
  p.textAlign(p.CENTER, p.CENTER);
  p.textSize(48);
  p.textStyle(p.BOLD);
  p.textFont('monospace');
  
  for (const ft of state.floatingTexts) {
    const alpha = (ft.life / ft.maxLife) * 255;
    
    (p.drawingContext as CanvasRenderingContext2D).shadowBlur = 10;
    (p.drawingContext as CanvasRenderingContext2D).shadowColor = 'black';
    
    p.fill(255, 50, 50, alpha); 
    if (ft.color === '#FFD700') {
         p.fill(255, 215, 0, alpha);
    }

    p.stroke(100, 0, 0, alpha);
    p.strokeWeight(4);
    p.text(ft.text, ft.x, ft.y);
  }
  p.pop();
}

function drawGameOver(p: p5, msg: string) {
}

export default CombatGame;
