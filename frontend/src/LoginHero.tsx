// Static picture-book illustration for the sign-in screen: a cozy home with its helpers
// (landlord with keys, tenant and cat at the door, handyman with a toolbox).
import React from "react";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient as Grad, Path, Rect, Stop } from "react-native-svg";

// Illustration palette: fixed on purpose so the picture looks the same in light and dark mode.
const P = {
  backdrop: "#FBF1E3", sun: "#FFD98A", cloud: "#FFFFFF", hill: ["#C5DDB4", "#9CC189"], hillBack: "#DCEBD0",
  wall: "#F7EFE3", wallShade: "#EADCC8", roof: "#D9826B", roofTrim: "#B9654F", chimney: "#C9B49A", door: "#6E9A78", doorDark: "#4A6B53",
  glow: "#FFE7A3", frame: "#FFFFFF", curtain: "#F3B9A6", path: "#EBDDC6", trunk: "#9A7556", leaf: ["#7FAE74", "#93BE84", "#6A9A62"],
  flower: ["#F49C9C", "#FFD166", "#FFFFFF"], ink: "#3A2A20", cheek: "#F4A6A0", shadow: "#3A2A20",
};

type Look = { skin: string; hair: string; shirt: string; pants: string; long?: boolean };

function Person({ x, y, look, pose, children }: { x: number; y: number; look: Look; pose: "wave" | "hold"; children?: React.ReactNode }) {
  return (
    <G transform={`translate(${x},${y})`}>
      <Ellipse cx={0} cy={0} rx={20} ry={4} fill={P.shadow} opacity={0.12} />
      <Rect x={-10} y={-34} width={8} height={32} rx={4} fill={look.pants} />
      <Rect x={2} y={-34} width={8} height={32} rx={4} fill={look.pants} />
      <Ellipse cx={-6} cy={-2} rx={6.5} ry={3.2} fill={P.ink} />
      <Ellipse cx={6} cy={-2} rx={6.5} ry={3.2} fill={P.ink} />
      {look.long ? <Path d="M-13,-80 Q-15,-60 -9,-56 L9,-56 Q15,-60 13,-80 Z" fill={look.hair} /> : null}
      <Line x1={-12} y1={-60} x2={-18} y2={-38} stroke={look.shirt} strokeWidth={7} strokeLinecap="round" />
      <Circle cx={-18.5} cy={-36} r={4} fill={look.skin} />
      {pose === "wave" ? (
        <>
          <Line x1={12} y1={-60} x2={22} y2={-82} stroke={look.shirt} strokeWidth={7} strokeLinecap="round" />
          <Circle cx={23} cy={-85} r={4} fill={look.skin} />
        </>
      ) : (
        <>
          <Line x1={12} y1={-60} x2={18} y2={-40} stroke={look.shirt} strokeWidth={7} strokeLinecap="round" />
          <Circle cx={18.5} cy={-37} r={4} fill={look.skin} />
        </>
      )}
      <Path d="M-15,-34 Q-17,-66 0,-68 Q17,-66 15,-34 Z" fill={look.shirt} />
      <Circle cx={0} cy={-80} r={11.5} fill={look.skin} />
      <Path d="M-11.5,-81 Q-11,-95 0,-94 Q11,-95 11.5,-81 Q6,-88 0,-87 Q-6,-88 -11.5,-81 Z" fill={look.hair} />
      <Circle cx={-4} cy={-79} r={1.4} fill={P.ink} />
      <Circle cx={4} cy={-79} r={1.4} fill={P.ink} />
      <Circle cx={-7} cy={-75} r={2.2} fill={P.cheek} opacity={0.6} />
      <Circle cx={7} cy={-75} r={2.2} fill={P.cheek} opacity={0.6} />
      <Path d="M-3,-74.5 Q0,-71.5 3,-74.5" stroke={P.ink} strokeWidth={1.3} fill="none" strokeLinecap="round" />
      {children}
    </G>
  );
}

function Window({ x, y }: { x: number; y: number }) {
  return (
    <G>
      <Rect x={x - 3} y={y - 3} width={38} height={36} rx={6} fill={P.frame} />
      <Rect x={x} y={y} width={32} height={30} rx={4} fill={P.glow} />
      <Path d={`M${x},${y + 2} Q${x + 9},${y + 12} ${x + 4},${y + 30} L${x},${y + 30} Z`} fill={P.curtain} />
      <Path d={`M${x + 32},${y + 2} Q${x + 23},${y + 12} ${x + 28},${y + 30} L${x + 32},${y + 30} Z`} fill={P.curtain} />
      <Line x1={x + 16} y1={y} x2={x + 16} y2={y + 30} stroke={P.frame} strokeWidth={2.5} />
      <Rect x={x - 5} y={y + 31} width={42} height={8} rx={3} fill={P.roofTrim} />
      {[0, 1, 2, 3, 4].map((i) => <Circle key={i} cx={x + 1 + i * 7.5} cy={y + 30} r={3.6} fill={P.flower[i % 3]} />)}
    </G>
  );
}

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x},${y}) scale(${s})`} opacity={0.95}>
      <Ellipse cx={0} cy={0} rx={26} ry={12} fill={P.cloud} />
      <Circle cx={-8} cy={-8} r={11} fill={P.cloud} />
      <Circle cx={8} cy={-10} r={14} fill={P.cloud} />
    </G>
  );
}

export function LoginHero({ size = 320 }: { size?: number }) {
  return (
    <Svg testID="login-hero" width={size} height={size} viewBox="0 0 400 400">
      <Defs>
        <Grad id="hill" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={P.hill[0]} /><Stop offset="1" stopColor={P.hill[1]} /></Grad>
        <Grad id="roof" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#E59A82" /><Stop offset="1" stopColor={P.roof} /></Grad>
      </Defs>

      {/* sky */}
      <Circle cx={200} cy={200} r={182} fill={P.backdrop} />
      <Circle cx={312} cy={92} r={40} fill={P.sun} opacity={0.3} />
      <Circle cx={312} cy={92} r={26} fill={P.sun} />
      <Cloud x={88} y={96} />
      <Cloud x={250} y={60} s={0.7} />

      {/* ground */}
      <Ellipse cx={200} cy={318} rx={190} ry={40} fill={P.hillBack} />
      <Path d="M18,330 Q200,292 382,330 Q392,372 300,384 Q200,396 100,384 Q8,372 18,330 Z" fill="url(#hill)" />

      {/* tree */}
      <Rect x={56} y={236} width={12} height={84} rx={5} fill={P.trunk} />
      <Circle cx={62} cy={222} r={34} fill={P.leaf[0]} />
      <Circle cx={42} cy={246} r={22} fill={P.leaf[2]} />
      <Circle cx={84} cy={244} r={22} fill={P.leaf[1]} />
      <Circle cx={52} cy={212} r={5} fill={P.flower[0]} />
      <Circle cx={76} cy={230} r={5} fill={P.flower[0]} />

      {/* house */}
      <Rect x={240} y={128} width={18} height={44} rx={3} fill={P.chimney} />
      <Circle cx={250} cy={114} r={6} fill={P.cloud} opacity={0.85} />
      <Circle cx={259} cy={100} r={8} fill={P.cloud} opacity={0.75} />
      <Circle cx={270} cy={84} r={10} fill={P.cloud} opacity={0.6} />
      <Rect x={136} y={184} width={128} height={128} rx={6} fill={P.wall} />
      <Rect x={136} y={296} width={128} height={16} rx={4} fill={P.wallShade} />
      <Path d="M122,194 L200,124 L278,194 Z" fill="url(#roof)" stroke={P.roofTrim} strokeWidth={7} strokeLinejoin="round" />
      <Circle cx={200} cy={165} r={13} fill={P.frame} />
      <Circle cx={200} cy={165} r={10} fill={P.glow} />
      <Path d="M195,165 L199,169 L206,161" stroke={P.doorDark} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Window x={150} y={210} />
      <Window x={218} y={210} />
      <Path d="M183,312 L183,262 Q183,244 200,244 Q217,244 217,262 L217,312 Z" fill={P.door} />
      <Path d="M189,300 L189,264 Q189,251 200,251 Q211,251 211,264 L211,300 Z" fill={P.doorDark} opacity={0.25} />
      <Circle cx={210} cy={282} r={2.4} fill={P.sun} />
      <Path d="M186,312 L214,312 L236,356 L164,356 Z" fill={P.path} />
      <Circle cx={146} cy={312} r={11} fill={P.leaf[1]} />
      <Circle cx={160} cy={315} r={8} fill={P.leaf[0]} />
      <Circle cx={254} cy={312} r={11} fill={P.leaf[1]} />
      <Circle cx={240} cy={315} r={8} fill={P.leaf[0]} />

      {/* landlord with keys */}
      <Person x={112} y={350} pose="wave" look={{ skin: "#F1C9A5", hair: "#5B4636", shirt: "#4A6B53", pants: "#33424F" }}>
        <Circle cx={27} cy={-95} r={5} fill="none" stroke={P.sun} strokeWidth={2.5} />
        <Line x1={27} y1={-100} x2={27} y2={-110} stroke={P.sun} strokeWidth={2.5} strokeLinecap="round" />
        <Line x1={27} y1={-106} x2={31} y2={-106} stroke={P.sun} strokeWidth={2.5} strokeLinecap="round" />
      </Person>

      {/* tenant and cat at the door */}
      <Person x={268} y={344} pose="wave" look={{ skin: "#C98F67", hair: "#2E2320", shirt: "#7FA7FF", pants: "#5468A8", long: true }} />
      <G transform="translate(236,346)">
        <Ellipse cx={0} cy={0} rx={13} ry={3} fill={P.shadow} opacity={0.12} />
        <Path d="M10,-6 Q22,-10 18,-24" stroke="#E9A25E" strokeWidth={4} fill="none" strokeLinecap="round" />
        <Ellipse cx={2} cy={-8} rx={11} ry={8} fill="#E9A25E" />
        <Circle cx={-8} cy={-17} r={7.5} fill="#E9A25E" />
        <Path d="M-14,-21 L-13,-29 L-8,-23 Z M-6,-23 L-2,-29 L-1,-21 Z" fill="#E9A25E" />
        <Circle cx={-10.5} cy={-17} r={1.1} fill={P.ink} />
        <Circle cx={-5.5} cy={-17} r={1.1} fill={P.ink} />
      </G>

      {/* handyman with hard hat and toolbox */}
      <Person x={334} y={352} pose="hold" look={{ skin: "#E8B48C", hair: "#7A4E2D", shirt: "#F2A541", pants: "#3E5C7A" }}>
        <Path d="M-13,-84 Q-13,-99 0,-99 Q13,-99 13,-84 Z" fill="#FFD166" />
        <Rect x={-15} y={-86} width={30} height={4} rx={2} fill="#E9B23A" />
        <Path d="M12,-38 Q20,-50 28,-38" stroke="#8E2F22" strokeWidth={3} fill="none" />
        <Rect x={8} y={-38} width={26} height={17} rx={3} fill="#D9534F" />
        <Rect x={8} y={-32} width={26} height={2.5} fill="#B23D3A" />
      </Person>

      {/* friendly chat bubble between the helpers */}
      <G transform="translate(300,186)">
        <Rect x={-30} y={-18} width={60} height={34} rx={14} fill={P.frame} />
        <Path d="M-6,16 L2,16 L-8,27 Z" fill={P.frame} />
        <Path d="M-3,-6 C-3,-12 -12,-12 -12,-5 C-12,1 -3,6 -3,8 C-3,6 6,1 6,-5 C6,-12 -3,-12 -3,-6 Z" fill={P.flower[0]} transform="translate(0,1)" />
        <Circle cx={14} cy={-1} r={2.5} fill={P.doorDark} />
        <Circle cx={22} cy={-1} r={2.5} fill={P.doorDark} opacity={0.6} />
      </G>

      {/* sparkles */}
      <Path d="M108,160 L111,168 L119,171 L111,174 L108,182 L105,174 L97,171 L105,168 Z" fill={P.sun} />
      <Path d="M350,236 L352,241 L357,243 L352,245 L350,250 L348,245 L343,243 L348,241 Z" fill={P.sun} />
    </Svg>
  );
}
