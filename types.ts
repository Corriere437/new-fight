
// Game Entities

export interface Point {
  x: number;
  y: number;
}

export interface PlayerState {
  id: 'left' | 'right';
  hp: number;
  isAI: boolean; // true if this is the virtual target
  color: string;
  lastPunchTime: number;
  detected: boolean;
  isShielding: boolean; // Defense state
  // Special Attack State
  isCharging: boolean;
  chargeStartTime: number;
  chargeLevel: number; // 0.0 to 1.0
  // Sword State
  hasSword: boolean;
  prevSwordY: number;
  lastSwordFireTime: number;
  
  lastPoseTime: number;
  boundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;

  // Velocity tracking for punches
  prevWrists: {
    left: Point;
    right: Point;
  };
}

export interface Projectile {
  id: string;
  type: 'standard' | 'special' | 'sword'; // Distinguish attack types
  damage: number;
  blockDamage: number;
  x: number;
  y: number;
  vx: number; // Velocity X
  vy: number; // Velocity Y
  owner: 'left' | 'right';
  active: boolean;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number; // Frames remaining
  maxLife: number;
  vy: number;
}

export interface GameStats {
  leftHp: number;
  rightHp: number;
  playerCount: number;
}

// MediaPipe Types (Simplified for our use)
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface NormalizedLandmarkList extends Array<Landmark> {}

export interface Results {
  poseLandmarks: NormalizedLandmarkList;
  segmentationMask: ImageBitmap | HTMLCanvasElement;
}
