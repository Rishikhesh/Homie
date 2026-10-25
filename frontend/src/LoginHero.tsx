// Hand-built isometric "3D" hero for the sign-in screen: a little home on a floating tile with rent, repair and chat tokens orbiting it.
import React, { useEffect } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient as Grad, Path, Polygon, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

// Illustration palette: fixed on purpose so the 3D shading reads the same in light and dark mode.
const P = {
  wallL: ["#F4EDE2", "#E6DACB"], wallR: ["#D9CBB8", "#C4B39D"], roofL: ["#6E9A78", "#4A6B53"], roofR: ["#4A6B53", "#36503D"],
  grassTop: ["#B9D3A8", "#93B883"], grassSide: "#6F9A62", soil: "#8A6A4F", door: "#7A5236", win: ["#FFF6C9", "#F2D66B"], chimney: "#B8A48C",
  coin: ["#FFD978", "#E9A93A"], coinEdge: "#C7862A", wrench: ["#E8EEF2", "#B5C3CC"], tile: ["#FFFFFF", "#E9EFEA"], check: ["#4CC07A", "#2E9A58"], chat: ["#7FA7FF", "#4F7BE8"],
};

function Float({ children, delay = 0, amp = 8, dur = 2200, style }: { children: React.ReactNode; delay?: number; amp?: number; dur?: number; style: any }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-amp, { duration: dur, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: dur, easing: Easing.inOut(Easing.sin) })), -1));
  }, [reduce, y, delay, amp, dur]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View pointerEvents="none" style={[{ position: "absolute" }, style, st]}>{children}</Animated.View>;
}

function Coin({ size = 64 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs><Grad id="cg" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={P.coin[0]} /><Stop offset="1" stopColor={P.coin[1]} /></Grad></Defs>
      <Ellipse cx="32" cy="38" rx="24" ry="20" fill={P.coinEdge} />
      <Ellipse cx="32" cy="32" rx="24" ry="20" fill="url(#cg)" />
      <Ellipse cx="32" cy="32" rx="17" ry="14" fill="none" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={2} />
      <SvgText x="32" y="39" fontSize="20" fontWeight="800" fill="#8A5A12" textAnchor="middle">$</SvgText>
    </Svg>
  );
}

function Token({ size = 62, kind }: { size?: number; kind: "wrench" | "check" | "chat" }) {
  const g = kind === "check" ? P.check : kind === "chat" ? P.chat : P.tile;
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs><Grad id={`t${kind}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={g[0]} /><Stop offset="1" stopColor={g[1]} /></Grad></Defs>
      {/* isometric tile: top + depth */}
      <Path d="M32 14 L58 28 L58 36 L32 50 L6 36 L6 28 Z" fill="#000" opacity={0.12} transform="translate(0,6)" />
      <Path d="M6 28 L32 42 L32 50 L6 36 Z" fill={g[1]} opacity={0.85} />
      <Path d="M58 28 L32 42 L32 50 L58 36 Z" fill={g[1]} opacity={0.65} />
      <Path d="M32 14 L58 28 L32 42 L6 28 Z" fill={`url(#t${kind})`} />
      {kind === "wrench" ? (
        <G transform="translate(32 28) rotate(-35)">
          <Rect x="-2" y="-2.5" width="17" height="5" rx="2.5" fill="#5B6B75" />
          <Circle cx="-5" cy="0" r="7" fill="#5B6B75" />
          <Rect x="-13" y="-2.2" width="8" height="4.4" fill={P.tile[0]} />
        </G>
      ) : kind === "check" ? (
        <Path d="M22 28 l7 6 l13 -11" stroke="#FFFFFF" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ) : (
        <G>
          <Path d="M20 22 h24 a4 4 0 0 1 4 4 v6 a4 4 0 0 1 -4 4 h-14 l-6 5 v-5 h-4 a4 4 0 0 1 -4 -4 v-6 a4 4 0 0 1 4 -4 z" fill="#FFFFFF" />
          <Circle cx="26" cy="29" r="2" fill={P.chat[1]} /><Circle cx="32" cy="29" r="2" fill={P.chat[1]} /><Circle cx="38" cy="29" r="2" fill={P.chat[1]} />
        </G>
      )}
    </Svg>
  );
}

function House({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 300 300">
      <Defs>
        <Grad id="gt" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={P.grassTop[0]} /><Stop offset="1" stopColor={P.grassTop[1]} /></Grad>
        <Grad id="wl" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={P.wallL[0]} /><Stop offset="1" stopColor={P.wallL[1]} /></Grad>
        <Grad id="wr" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={P.wallR[0]} /><Stop offset="1" stopColor={P.wallR[1]} /></Grad>
        <Grad id="rl" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={P.roofL[0]} /><Stop offset="1" stopColor={P.roofL[1]} /></Grad>
        <Grad id="rr" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={P.roofR[0]} /><Stop offset="1" stopColor={P.roofR[1]} /></Grad>
        <Grad id="wi" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={P.win[0]} /><Stop offset="1" stopColor={P.win[1]} /></Grad>
        <RadialGradient id="sh" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#000" stopOpacity={0.22} /><Stop offset="1" stopColor="#000" stopOpacity={0} /></RadialGradient>
      </Defs>
      {/* soft shadow under the floating island */}
      <Ellipse cx="150" cy="288" rx="105" ry="12" fill="url(#sh)" />
      {/* island: soil sides + grass top */}
      <Polygon points="40,212 150,267 150,290 40,235" fill={P.soil} />
      <Polygon points="260,212 150,267 150,290 260,235" fill="#735740" />
      <Polygon points="40,212 150,267 150,276 40,221" fill={P.grassSide} />
      <Polygon points="260,212 150,267 150,276 260,221" fill="#5E8752" />
      <Polygon points="150,157 260,212 150,267 40,212" fill="url(#gt)" />
      {/* path to the door */}
      <Polygon points="170,226 186,218 214,232 198,240" fill="#EFE6D6" opacity={0.9} />
      {/* bushes */}
      <Circle cx="78" cy="214" r="13" fill="#5E8752" /><Circle cx="90" cy="219" r="10" fill="#6F9A62" />
      <Circle cx="232" cy="212" r="11" fill="#5E8752" /><Circle cx="222" cy="218" r="8" fill="#6F9A62" />
      {/* walls */}
      <Polygon points="96,196 150,223 150,163 96,136" fill="url(#wl)" />
      <Polygon points="150,223 204,196 204,136 150,163" fill="url(#wr)" />
      {/* window (left wall) */}
      <Polygon points="110,168 132,179 132,159 110,148" fill="url(#wi)" />
      <Polygon points="110,168 132,179 132,159 110,148" fill="none" stroke="#FFFFFF" strokeWidth={2.5} />
      <Path d="M121 153.5 V173.5 M110 158 L132 169" stroke="#FFFFFF" strokeWidth={2} />
      {/* door (right wall) */}
      <Polygon points="168,214 186,205 186,178 168,187" fill={P.door} />
      <Circle cx="182" cy="198" r="1.8" fill="#F2D66B" />
      {/* little window (right wall) */}
      <Polygon points="192,174 200,170 200,160 192,164" fill="url(#wi)" />
      {/* roof */}
      <Polygon points="88,140 150,170 150,176 88,146" fill="#2F4636" />
      <Polygon points="212,140 150,170 150,176 212,146" fill="#26392C" />
      <Polygon points="88,140 150,170 150,82" fill="url(#rl)" />
      <Polygon points="212,140 150,170 150,82" fill="url(#rr)" />
      <Polygon points="150,82 212,140 150,110 88,140" fill="#000" opacity={0} />
      {/* chimney */}
      <Polygon points="178,106 188,101 188,82 178,87" fill={P.chimney} />
      <Polygon points="172,103 178,106 178,87 172,84" fill="#A6927A" />
      <Polygon points="172,84 178,87 188,82 182,79" fill="#CDBBA3" />
      {/* sparkle */}
      <Path d="M236 92 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill="#FFFFFF" opacity={0.9} />
      <Path d="M62 120 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" fill="#FFFFFF" opacity={0.7} />
    </Svg>
  );
}


// ---------- Doorman agent: a friendly bot in a doorman's cap ----------
const AEllipse = Animated.createAnimatedComponent(Ellipse);
const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);

function Bot({ size }: { size: number }) {
  const reduce = useReducedMotion();
  const blink = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    blink.value = withRepeat(withSequence(withDelay(2600, withTiming(0.1, { duration: 90 })), withTiming(1, { duration: 120 })), -1);
  }, [reduce, blink]);
  const eye = useAnimatedProps(() => ({ ry: 5 * blink.value }));
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <Grad id="bh" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#FFFFFF" /><Stop offset="1" stopColor="#DDE7E0" /></Grad>
        <Grad id="bc" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#5E8A6A" /><Stop offset="1" stopColor="#2F4636" /></Grad>
        <RadialGradient id="bg" cx="50%" cy="55%" r="50%"><Stop offset="0" stopColor="#9FE3B4" stopOpacity={0.55} /><Stop offset="1" stopColor="#9FE3B4" stopOpacity={0} /></RadialGradient>
      </Defs>
      <Circle cx="50" cy="56" r="48" fill="url(#bg)" />
      {/* head */}
      <Rect x="22" y="38" width="56" height="44" rx="18" fill="url(#bh)" />
      <Rect x="22" y="70" width="56" height="12" rx="6" fill="#C9D7CD" opacity={0.6} />
      {/* visor screen + eyes */}
      <Rect x="30" y="48" width="40" height="22" rx="11" fill="#1F2E24" />
      <AEllipse cx="42" cy="59" rx="4.5" fill="#7DF0A6" animatedProps={eye} />
      <AEllipse cx="58" cy="59" rx="4.5" fill="#7DF0A6" animatedProps={eye} />
      {/* ear lights */}
      <Circle cx="20" cy="60" r="4" fill="#F2C94C" /><Circle cx="80" cy="60" r="4" fill="#F2C94C" />
      {/* doorman cap */}
      <Path d="M26 38 Q50 14 74 38 Z" fill="url(#bc)" />
      <Rect x="25" y="34" width="50" height="7" rx="3" fill="#F2C94C" />
      <Path d="M24 41 Q50 50 76 41 L72 44 Q50 52 28 44 Z" fill="#26392C" />
      <Circle cx="50" cy="27" r="3.4" fill="#F2C94C" />
    </Svg>
  );
}

type Orb = { kind: "coin" | "wrench" | "chat" | "check"; phase: number };
const ORBS: Orb[] = [{ kind: "coin", phase: 0 }, { kind: "wrench", phase: Math.PI / 2 }, { kind: "chat", phase: Math.PI }, { kind: "check", phase: (3 * Math.PI) / 2 }];

/** The whole scene: Doorman bot over a floating home, beaming tasks to tokens that orbit the house. `size` = box width. */
export function LoginHero({ size = 320 }: { size?: number }) {
  const reduce = useReducedMotion();
  const S = size;
  const bob = useSharedValue(0);
  const a = useSharedValue(0.4);
  const flow = useSharedValue(0);
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    bob.value = withRepeat(withSequence(withTiming(-6, { duration: 2600, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.sin) })), -1);
    a.value = withRepeat(withTiming(0.4 + 2 * Math.PI, { duration: 16000, easing: Easing.linear }), -1);
    flow.value = withRepeat(withTiming(-24, { duration: 900, easing: Easing.linear }), -1);
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1);
  }, [reduce, bob, a, flow, pulse]);
  const houseSt = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const cx = S * 0.5, cy = S * 0.66, rx = S * 0.45, ry = S * 0.15, tok = S * 0.17;
  const bot = S * 0.26, bx = S * 0.5, by = S * 0.13;
  return (
    <View testID="login-hero" accessible accessibilityLabel="Doorman, an AI helper, taking care of rent, repairs and messages for a home" style={{ width: S, height: S, alignSelf: "center" }}>
      {/* orbit track + beams */}
      <Svg width={S} height={S} style={{ position: "absolute" }}>
        <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} stroke="#7FA88A" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 7" fill="none" />
        {ORBS.map((o) => <Beam key={o.kind} o={o} a={a} flow={flow} from={{ x: bx, y: by + bot * 0.42 }} c={{ cx, cy, rx, ry }} />)}
        <PulseRing x={bx} y={by + bot * 0.1} r={bot * 0.55} p={pulse} />
      </Svg>
      <Animated.View style={[{ position: "absolute", left: S * 0.11, top: S * 0.2, zIndex: 1 }, houseSt]}><House size={S * 0.78} /></Animated.View>
      {ORBS.map((o) => <OrbToken key={o.kind} o={o} a={a} c={{ cx, cy, rx, ry }} size={tok} />)}
      <Float amp={5} dur={1600} style={{ left: bx - bot / 2, top: by - bot / 2, zIndex: 4 }}><Bot size={bot} /></Float>
    </View>
  );
}

type C = { cx: number; cy: number; rx: number; ry: number };
function Beam({ o, a, flow, from, c }: { o: Orb; a: any; flow: any; from: { x: number; y: number }; c: C }) {
  const props = useAnimatedProps(() => {
    const t = a.value + o.phase;
    const y = c.cy + c.ry * Math.sin(t);
    return { x2: c.cx + c.rx * Math.cos(t), y2: y, strokeDashoffset: flow.value, strokeOpacity: Math.sin(t) > 0 ? 0.55 : 0.18 };
  });
  return <ALine x1={from.x} y1={from.y} stroke="#4CC07A" strokeWidth={2} strokeDasharray="3 9" strokeLinecap="round" animatedProps={props} />;
}

function PulseRing({ x, y, r, p }: { x: number; y: number; r: number; p: any }) {
  const props = useAnimatedProps(() => ({ r: r * (0.9 + p.value * 0.9), strokeOpacity: 0.5 * (1 - p.value) }));
  return <ACircle cx={x} cy={y} stroke="#4CC07A" strokeWidth={2} fill="none" animatedProps={props} />;
}

function OrbToken({ o, a, c, size }: { o: Orb; a: any; c: C; size: number }) {
  const st = useAnimatedStyle(() => {
    const t = a.value + o.phase;
    const front = Math.sin(t);
    const k = 0.78 + 0.22 * (front + 1) / 2;
    return { opacity: 0.55 + 0.45 * (front + 1) / 2, zIndex: front > 0 ? 3 : 0, transform: [{ translateX: c.cx + c.rx * Math.cos(t) - size / 2 }, { translateY: c.cy + c.ry * front - size / 2 }, { scale: k }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0 }, st]}>
      {o.kind === "coin" ? <Coin size={size} /> : <Token kind={o.kind} size={size} />}
    </Animated.View>
  );
}
