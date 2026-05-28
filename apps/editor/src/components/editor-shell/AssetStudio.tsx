import { useState, useRef, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Plus, 
  Trash, 
  Code, 
  Sliders, 
  ChevronDown, 
  ChevronRight, 
  Box, 
  Gamepad2, 
  Settings,
  Layers,
  Sparkles,
  Zap,
  Check,
  Volume2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DefaultHumanoidCharacter } from "@/viewport/components/DefaultHumanoidCharacter";
import type { DefaultHumanoidRigRefs } from "@/viewport/components/DefaultHumanoidCharacter";
import type { Object3D } from "three";

type MorphusFileRecord = {
  content: string;
  language: "html" | "javascript" | "css" | "json" | "asset" | "text";
  mimeType?: string;
  path: string;
  updatedAt: number;
};

type AssetStudioProps = {
  files: MorphusFileRecord[];
  onSendMessage: (prompt: string) => void;
};

// Available bones for selection and tweaking
const BONES = [
  { id: "head", label: "Head" },
  { id: "chest", label: "Chest" },
  { id: "core", label: "Core (Spine)" },
  { id: "leftArm", label: "Left Shoulder/Arm" },
  { id: "rightArm", label: "Right Shoulder/Arm" },
  { id: "leftLeg", label: "Left Thigh/Leg" },
  { id: "rightLeg", label: "Right Thigh/Leg" },
];

// Available morph weights
const MORPHS = [
  { id: "blink", label: "Blink (Eyes Closed)", default: 0 },
  { id: "smile", label: "Smile / Happy", default: 0 },
  { id: "angry", label: "Angry / Frown", default: 0 },
  { id: "speak", label: "Mouth Open (Vocal)", default: 0 },
];

export function AssetStudio({ files, onSendMessage }: AssetStudioProps) {
  // Active asset selection
  const glbFiles = files.filter(f => f.path.endsWith(".glb") || f.path.endsWith(".gltf") || f.language === "asset");
  const [selectedAssetPath, setSelectedAssetPath] = useState<string>(
    glbFiles[0]?.path || "assets/character/hero.glb"
  );

  // Studio tabs inside left sidebar
  const [sidebarTab, setSidebarTab] = useState<"bones" | "morphs">("bones");

  // Tweaker states
  const [selectedBone, setSelectedBone] = useState<string>("leftArm");
  const [boneRotations, setBoneRotations] = useState<Record<string, { x: number; y: number; z: number }>>({
    head: { x: 0, y: 0, z: 0 },
    chest: { x: 0, y: 0, z: 0 },
    core: { x: 0.02, y: 0, z: 0 },
    leftArm: { x: 0.2, y: 0, z: 0.6 },
    rightArm: { x: 0.2, y: 0, z: -0.6 },
    leftLeg: { x: -0.02, y: 0, z: 0.01 },
    rightLeg: { x: 0.02, y: 0, z: -0.01 },
  });

  const [morphWeights, setMorphWeights] = useState<Record<string, number>>({
    blink: 0,
    smile: 0.1,
    angry: 0,
    speak: 0,
  });

  // Timeline / playback states
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [keyframes, setKeyframes] = useState<number[]>([0, 30, 60]);

  // Physics settings
  const [colliderType, setColliderType] = useState<"box" | "capsule" | "sphere" | "mesh">("capsule");
  const [rigidBodyType, setRigidBodyType] = useState<"dynamic" | "static" | "kinematic">("dynamic");
  const [mass, setMass] = useState(1.0);
  const [gravityScale, setGravityScale] = useState(1.0);
  const [bounce, setBounce] = useState(0.2);
  const [friction, setFriction] = useState(0.5);

  // Animation settings
  const [animationName, setAnimationName] = useState("idle");
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [blendTime, setBlendTime] = useState(0.25);

  // UI state for generated code
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");

  // Refs for rig manipulation
  const rigRefs = useRef<DefaultHumanoidRigRefs>({
    chestRef: useRef<Object3D | null>(null),
    coreRef: useRef<Object3D | null>(null),
    headRef: useRef<Object3D | null>(null),
    leftArmRef: useRef<Object3D | null>(null),
    leftLegRef: useRef<Object3D | null>(null),
    rightArmRef: useRef<Object3D | null>(null),
    rightLegRef: useRef<Object3D | null>(null),
  });

  // Handle bone slider changes
  const handleBoneRotationChange = (axis: "x" | "y" | "z", value: number) => {
    setBoneRotations(prev => ({
      ...prev,
      [selectedBone]: {
        ...prev[selectedBone],
        [axis]: value,
      }
    }));
  };

  // Add keyframe at current frame
  const addKeyframe = () => {
    if (!keyframes.includes(currentFrame)) {
      setKeyframes(prev => [...prev, currentFrame].sort((a, b) => a - b));
    }
  };

  // Delete keyframe at current frame
  const deleteKeyframe = () => {
    setKeyframes(prev => prev.filter(f => f !== currentFrame));
  };

  // Generate JavaScript & physics configuration block
  const generateSnippet = () => {
    const config = {
      assetPath: selectedAssetPath,
      physics: {
        collider: colliderType,
        type: rigidBodyType,
        mass,
        gravityScale,
        bounce,
        friction,
      },
      animation: {
        name: animationName,
        speed: playbackSpeed,
        blend: blendTime,
        initialPose: boneRotations,
      }
    };

    const code = `// Morpheus Physics & Animation Initialization
import { Physics, Collider, Animation } from "morpheus-game-engine";

export function initCharacter(scene) {
  const character = scene.createEntity({
    name: "PlayerCharacter",
    model: "${config.assetPath}",
  });

  // Add physics body
  character.addComponent(Physics.RigidBody, {
    type: "${config.physics.type}",
    mass: ${config.physics.mass},
    gravityScale: ${config.physics.gravityScale},
  });

  // Add collider
  character.addComponent(Physics.Collider, {
    shape: "${config.physics.collider}",
    restitution: ${config.physics.bounce},
    friction: ${config.physics.friction},
  });

  // Load and play custom animations
  const animController = character.addComponent(Animation.Controller, {
    defaultAnimation: "${config.animation.name}",
    speed: ${config.animation.speed},
    blendDuration: ${config.animation.blend},
  });

  // Apply customized initial pose
  const pose = ${JSON.stringify(config.animation.initialPose, null, 2)};
  Object.entries(pose).forEach(([boneName, rotation]) => {
    animController.setBoneRotation(boneName, rotation.x, rotation.y, rotation.z);
  });

  return character;
}`;
    setGeneratedCode(code);
    setShowCodeModal(true);
  };

  // Tell Morpheus to apply these settings to the game code
  const handleApplyToMorpheus = () => {
    const prompt = `Please update the game code to configure the 3D character asset "${selectedAssetPath}" with physics and animations:
- Physics RigidBody Type: "${rigidBodyType}"
- Collider Shape: "${colliderType}"
- Mass: ${mass}
- Gravity Scale: ${gravityScale}
- Restitution/Bounce: ${bounce}
- Friction: ${friction}
- Default Animation: "${animationName}" with speed ${playbackSpeed}
Please modify index.html/main.js to include these physics and animation parameters.`;
    onSendMessage(prompt);
  };

  // Playback loop simulation
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentFrame(prev => {
        const next = prev + 1;
        return next > 100 ? 0 : next;
      });
    }, 33);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const activeBoneRot = boneRotations[selectedBone] || { x: 0, y: 0, z: 0 };

  return (
    <div className="flex h-full min-h-0 w-full bg-[#12161b] text-white">
      {/* LEFT SIDEBAR: Rig Bones & Morphs Inspector */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/8 bg-[#0f1217]">
        <div className="flex h-11 border-b border-white/8 bg-[#141920]">
          <button
            onClick={() => setSidebarTab("bones")}
            className={cn(
              "flex-1 text-[11px] font-semibold tracking-wider uppercase transition-colors",
              sidebarTab === "bones" ? "text-[#f6d07d] bg-white/[0.03]" : "text-white/44 hover:text-white/80"
            )}
          >
            Bones
          </button>
          <button
            onClick={() => setSidebarTab("morphs")}
            className={cn(
              "flex-1 text-[11px] font-semibold tracking-wider uppercase transition-colors",
              sidebarTab === "morphs" ? "text-[#f6d07d] bg-white/[0.03]" : "text-white/44 hover:text-white/80"
            )}
          >
            Morphs
          </button>
        </div>

        {sidebarTab === "bones" ? (
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div>
              <label className="text-[10px] font-bold tracking-widest text-white/34 uppercase">Select Bone</label>
              <div className="mt-1.5 space-y-1">
                {BONES.map(bone => (
                  <button
                    key={bone.id}
                    onClick={() => setSelectedBone(bone.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                      selectedBone === bone.id
                        ? "bg-[#f6d07d]/10 text-[#f6d07d] border border-[#f6d07d]/20"
                        : "text-white/58 hover:bg-white/[0.02] hover:text-white/80"
                    )}
                  >
                    <span>{bone.label}</span>
                    {selectedBone === bone.id && <Sliders className="size-3" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Rotation Sliders */}
            <div className="rounded-xl border border-white/5 bg-white/[0.01] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#f6d07d]/88 uppercase">
                <Sliders className="size-3.5" />
                Rotation (Rad)
              </div>
              
              <div className="mt-4 space-y-3">
                {["x", "y", "z"].map(axis => (
                  <div key={axis} className="space-y-1">
                    <div className="flex justify-between text-[11px] text-white/52 font-mono">
                      <span className="uppercase text-[#f6d07d]/72">{axis}-Axis</span>
                      <span>{(activeBoneRot[axis as "x"|"y"|"z"] || 0).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={axis === "y" ? "-3.14" : "-1.57"}
                      max={axis === "y" ? "3.14" : "1.57"}
                      step="0.05"
                      value={activeBoneRot[axis as "x"|"y"|"z"] || 0}
                      onChange={e => handleBoneRotationChange(axis as "x"|"y"|"z", parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#f6d07d]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div className="space-y-3">
              <label className="text-[10px] font-bold tracking-widest text-white/34 uppercase">Morph Target Weights</label>
              {MORPHS.map(morph => (
                <div key={morph.id} className="space-y-1.5 p-2 rounded-lg border border-white/5 bg-white/[0.01]">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-white/70">{morph.label}</span>
                    <span className="text-[#f6d07d]">{(morphWeights[morph.id] || 0).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={morphWeights[morph.id] || 0}
                    onChange={e => setMorphWeights(prev => ({ ...prev, [morph.id]: parseFloat(e.target.value) }))}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#f6d07d]"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-white/8 bg-[#141920] p-3 text-[10.5px] leading-relaxed text-white/44">
          Tweak initial poses and facial expressions of your character rig.
        </div>
      </aside>

      {/* CENTER: 3D Viewport & Scrubber Timeline */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#111418]">
        {/* Viewport Toolbar */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/8 bg-[#141920] px-4">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-lg border border-[#f6d07d]/20 bg-[#f6d07d]/10 text-[#f6d07d]">
              <Box className="size-3.5" />
            </span>
            <select
              value={selectedAssetPath}
              onChange={e => setSelectedAssetPath(e.target.value)}
              className="bg-transparent border-0 text-xs font-semibold text-white/88 outline-none cursor-pointer"
            >
              {glbFiles.length > 0 ? (
                glbFiles.map(f => (
                  <option key={f.path} value={f.path} className="bg-[#12161b] text-white">
                    {f.path.split("/").pop()}
                  </option>
                ))
              ) : (
                <option value="assets/character/hero.glb" className="bg-[#12161b] text-white">
                  hero.glb (Default Humanoid)
                </option>
              )}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 text-[9px] font-bold text-emerald-400 uppercase tracking-widest">
              Live Viewport
            </span>
          </div>
        </header>

        {/* 3D Scene Viewport */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-gradient-to-b from-[#14171d] to-[#0b0c10]">
          <Canvas camera={{ position: [0, 1.8, 3.2], fov: 45 }}>
            <ambientLight intensity={1.2} />
            <directionalLight position={[2, 4, 3]} intensity={1.5} castShadow />
            <directionalLight position={[-2, 2, -3]} intensity={0.5} />
            <DefaultHumanoidCharacter
              height={1.8}
              pose="idle"
              variant="player"
              rigRefs={rigRefs.current}
            />
            <HumanoidPoseUpdater
              rigRefs={rigRefs}
              boneRotations={boneRotations}
              morphWeights={morphWeights}
              currentFrame={currentFrame}
              isPlaying={isPlaying}
            />
            <OrbitControls target={[0, 1.0, 0]} makeDefault />
            <gridHelper args={[10, 10, "#f6d07d", "#222730"]} position={[0, 0, 0]} />
          </Canvas>

          {/* Canvas HUD overlay */}
          <div className="pointer-events-none absolute left-3 top-3 space-y-1 bg-black/40 backdrop-blur-md rounded-lg p-2.5 border border-white/5">
            <div className="text-[10px] text-white/50 uppercase tracking-wider">Active Bone</div>
            <div className="text-[11px] font-semibold text-[#f6d07d]">{selectedBone}</div>
            <div className="mt-1.5 text-[9px] text-white/40">Orbit: Left Click + Drag<br />Zoom: Scroll<br />Pan: Right Click + Drag</div>
          </div>
        </div>

        {/* Timeline Control Pane */}
        <div className="h-44 border-t border-white/8 bg-[#0f1217] flex flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/6 px-4 bg-[#141920]">
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-bold tracking-widest text-white/34 uppercase">Animation Timeline</span>
              <div className="flex items-center gap-1 bg-black/25 rounded-lg p-0.5">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="flex size-6 items-center justify-center rounded-md hover:bg-white/[0.05] text-[#f6d07d]"
                >
                  {isPlaying ? <Pause className="size-3.5 fill-[#f6d07d]" /> : <Play className="size-3.5 fill-[#f6d07d]" />}
                </button>
                <button
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentFrame(0);
                  }}
                  className="flex size-6 items-center justify-center rounded-md hover:bg-white/[0.05] text-white/60 hover:text-white"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </div>
              <div className="text-[11px] font-mono text-white/60">
                Frame <span className="text-[#f6d07d] font-bold">{currentFrame}</span> / 100
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={addKeyframe}
                className="flex items-center gap-1 rounded-lg border border-[#f6d07d]/20 bg-[#f6d07d]/10 px-2.5 py-1 text-[10px] text-[#f6d07d] font-medium transition-colors hover:bg-[#f6d07d]/20"
              >
                <Plus className="size-3" />
                Keyframe
              </button>
              <button
                onClick={deleteKeyframe}
                className="flex items-center gap-1 rounded-lg border border-white/10 hover:bg-white/[0.05] px-2.5 py-1 text-[10px] text-white/60 hover:text-white transition-colors"
              >
                <Trash className="size-3" />
                Clear
              </button>
            </div>
          </div>

          {/* Frame Scrubber Track */}
          <div className="flex-1 p-4 flex flex-col justify-center space-y-4">
            <div className="relative">
              {/* Frame Scrubber Slider */}
              <input
                type="range"
                min="0"
                max="100"
                value={currentFrame}
                onChange={e => setCurrentFrame(parseInt(e.target.value))}
                className="w-full h-2 bg-white/5 rounded-lg appearance-none cursor-pointer accent-[#f6d07d] z-10 relative"
              />
              
              {/* Keyframe diamonds overlay */}
              <div className="absolute inset-x-0 -bottom-1 h-3 pointer-events-none px-[4px]">
                {keyframes.map(kf => (
                  <div
                    key={kf}
                    style={{ left: `${kf}%` }}
                    className="absolute size-2.5 bg-[#f6d07d] rotate-45 transform -translate-x-1/2 border border-black shadow shadow-yellow-500/40"
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-between text-[9px] text-white/20 font-mono">
              <span>0F</span>
              <span>10F</span>
              <span>20F</span>
              <span>30F</span>
              <span>40F</span>
              <span>50F</span>
              <span>60F</span>
              <span>70F</span>
              <span>80F</span>
              <span>90F</span>
              <span>100F</span>
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT SIDEBAR: Physics & Configuration Settings */}
      <aside className="flex w-64 shrink-0 flex-col border-l border-white/8 bg-[#0f1217]">
        <div className="flex h-11 items-center border-b border-white/8 bg-[#141920] px-3.5">
          <span className="text-[10px] font-bold tracking-widest text-white/44 uppercase flex items-center gap-1.5">
            <Settings className="size-3.5 text-[#f6d07d]" />
            Config Inspector
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* PHYSICS PANEL */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#f6d07d]/88 uppercase">
              <Zap className="size-3.5" />
              Physics Engine
            </div>
            
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] text-white/42 uppercase">Collider Shape</label>
                <select
                  value={colliderType}
                  onChange={e => setColliderType(e.target.value as any)}
                  className="w-full rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5 text-xs text-white outline-none"
                >
                  <option value="capsule">Capsule (Character Rig)</option>
                  <option value="box">Box (Bounding Box)</option>
                  <option value="sphere">Sphere (Bounding Sphere)</option>
                  <option value="mesh">Mesh (Complex Hull)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-white/42 uppercase">Body Type</label>
                <select
                  value={rigidBodyType}
                  onChange={e => setRigidBodyType(e.target.value as any)}
                  className="w-full rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5 text-xs text-white outline-none"
                >
                  <option value="dynamic">Dynamic (Affected by force)</option>
                  <option value="static">Static (Immovable wall/floor)</option>
                  <option value="kinematic">Kinematic (Code driven motion)</option>
                </select>
              </div>

              {/* Float sliders for physics */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-white/42">Mass</span>
                  <span className="text-[#f6d07d]">{mass.toFixed(1)} kg</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10.0"
                  step="0.1"
                  value={mass}
                  onChange={e => setMass(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#f6d07d]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-white/42">Gravity Scale</span>
                  <span className="text-[#f6d07d]">{gravityScale.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="3.0"
                  step="0.1"
                  value={gravityScale}
                  onChange={e => setGravityScale(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#f6d07d]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-white/42">Bounciness (Restitution)</span>
                  <span className="text-[#f6d07d]">{bounce.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={bounce}
                  onChange={e => setBounce(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#f6d07d]"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* ANIMATION PANEL */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-[#f6d07d]/88 uppercase">
              <Gamepad2 className="size-3.5" />
              Animation State
            </div>
            
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[10px] text-white/42 uppercase">Default Clip</label>
                <select
                  value={animationName}
                  onChange={e => setAnimationName(e.target.value)}
                  className="w-full rounded-lg border border-white/8 bg-black/25 px-2.5 py-1.5 text-xs text-white outline-none"
                >
                  <option value="idle">Idle Loop</option>
                  <option value="walk">Walk Loop</option>
                  <option value="run">Run Loop</option>
                  <option value="jump">Jump / Fall</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-white/42">Playback Speed</span>
                  <span className="text-[#f6d07d]">{playbackSpeed.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="2.0"
                  step="0.05"
                  value={playbackSpeed}
                  onChange={e => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#f6d07d]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-white/42">Blend Time</span>
                  <span className="text-[#f6d07d]">{blendTime.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={blendTime}
                  onChange={e => setBlendTime(parseFloat(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#f6d07d]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="border-t border-white/8 bg-[#141920] p-3 space-y-2">
          <button
            onClick={generateSnippet}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 hover:bg-white/[0.04] py-2 text-xs font-semibold transition-colors"
          >
            <Code className="size-3.5 text-[#f6d07d]" />
            Generate JS Snippet
          </button>
          
          <button
            onClick={handleApplyToMorpheus}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#f6d07d]/20 bg-[#f6d07d]/10 hover:bg-[#f6d07d]/20 py-2 text-xs font-bold text-[#f6d07d] transition-colors"
          >
            <Sparkles className="size-3.5 fill-[#f6d07d]/20" />
            Apply Settings to Game
          </button>
        </div>
      </aside>

      {/* CODE OVERLAY MODAL */}
      {showCodeModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="w-full max-w-xl rounded-2xl border border-white/12 bg-[#12161b] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.5)] flex flex-col max-h-[90%]">
            <div className="flex items-center justify-between border-b border-white/8 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#f6d07d] flex items-center gap-1.5">
                <Code className="size-4" />
                Asset Rig Configuration
              </h3>
              <button 
                onClick={() => setShowCodeModal(false)}
                className="text-white/44 hover:text-white"
              >
                Close
              </button>
            </div>
            
            <div className="flex-1 overflow-auto mt-4 p-3 bg-black/30 rounded-xl font-mono text-[11px] leading-relaxed text-slate-200 border border-white/5">
              <pre>{generatedCode}</pre>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-white/8 pt-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedCode);
                }}
                className="rounded-lg border border-white/10 hover:bg-white/[0.05] px-3.5 py-1.5 text-xs text-white/80 transition-colors"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setShowCodeModal(false)}
                className="rounded-lg bg-[#f6d07d] text-black hover:bg-[#ebd06c] px-3.5 py-1.5 text-xs font-bold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component to sync sliders/poses with React Three Fiber rig ref
function HumanoidPoseUpdater({
  rigRefs,
  boneRotations,
  morphWeights,
  currentFrame,
  isPlaying,
}: {
  rigRefs: React.MutableRefObject<DefaultHumanoidRigRefs>;
  boneRotations: Record<string, { x: number; y: number; z: number }>;
  morphWeights: Record<string, number>;
  currentFrame: number;
  isPlaying: boolean;
}) {
  useFrame((state) => {
    const refs = rigRefs.current;
    
    // Apply head rotation
    if (refs.headRef?.current) {
      const rot = boneRotations.head || { x: 0, y: 0, z: 0 };
      refs.headRef.current.rotation.set(rot.x, rot.y, rot.z);
    }
    
    // Apply chest/spine rotation
    if (refs.chestRef?.current) {
      const rot = boneRotations.chest || { x: 0, y: 0, z: 0 };
      refs.chestRef.current.rotation.set(rot.x, rot.y, rot.z);
    }
    
    // Apply core rotation
    if (refs.coreRef?.current) {
      const rot = boneRotations.core || { x: 0.02, y: 0, z: 0 };
      refs.coreRef.current.rotation.set(rot.x, rot.y, rot.z);
    }

    // Apply left/right arm rotations
    if (refs.leftArmRef?.current) {
      const rot = boneRotations.leftArm || { x: 0.2, y: 0, z: 0.6 };
      refs.leftArmRef.current.rotation.set(rot.x, rot.y, rot.z);
    }
    if (refs.rightArmRef?.current) {
      const rot = boneRotations.rightArm || { x: 0.2, y: 0, z: -0.6 };
      refs.rightArmRef.current.rotation.set(rot.x, rot.y, rot.z);
    }

    // Apply left/right leg rotations
    if (refs.leftLegRef?.current) {
      const rot = boneRotations.leftLeg || { x: -0.02, y: 0, z: 0.01 };
      refs.leftLegRef.current.rotation.set(rot.x, rot.y, rot.z);
    }
    if (refs.rightLegRef?.current) {
      const rot = boneRotations.rightLeg || { x: 0.02, y: 0, z: -0.01 };
      refs.rightLegRef.current.rotation.set(rot.x, rot.y, rot.z);
    }

    // Subtle idle animation/breathing if playing
    if (isPlaying) {
      const t = state.clock.getElapsedTime();
      const wave = Math.sin(t * 3) * 0.02;
      
      if (refs.chestRef?.current) {
        refs.chestRef.current.rotation.x += wave;
      }
      
      // Breathing effect on arms
      if (refs.leftArmRef?.current) {
        refs.leftArmRef.current.rotation.z += wave * 0.5;
      }
      if (refs.rightArmRef?.current) {
        refs.rightArmRef.current.rotation.z -= wave * 0.5;
      }
    }
  });

  return null;
}
