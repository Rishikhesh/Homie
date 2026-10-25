// Hand-built isometric "3D" hero for the sign-in screen: a little home on a floating tile with rent, repair and chat tokens orbiting it.
import React, { useEffect } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as Grad, Path, Polygon, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

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

/** The whole floating scene. `size` = width of the scene box. */
export function LoginHero({ size = 320 }: { size?: number }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => { if (!reduce) y.value = withRepeat(withSequence(withTiming(-6, { duration: 2600, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.sin) })), -1); }, [reduce, y]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const k = size / 320;
  return (
    <View testID="login-hero" accessible accessibilityLabel="A little home with rent, repairs and messages taken care of" style={{ width: size, height: size, alignSelf: "center" }}>
      <Animated.View style={st}><House size={size} /></Animated.View>
      <Float delay={0} style={{ left: 6 * k, top: 40 * k }}><Coin size={62 * k} /></Float>
      <Float delay={500} amp={10} style={{ right: 4 * k, top: 120 * k }}><Token kind="wrench" size={64 * k} /></Float>
      <Float delay={900} amp={7} style={{ left: 14 * k, top: 168 * k }}><Token kind="chat" size={58 * k} /></Float>
      <Float delay={1300} amp={9} style={{ right: 36 * k, top: 22 * k }}><Token kind="check" size={56 * k} /></Float>
    </View>
  );
}
