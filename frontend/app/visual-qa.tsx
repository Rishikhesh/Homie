// Visual QA (DEMO_MODE only): every building block in every state, light/dark, normal/largest text — one scroll.
import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Card, Chip, ChipRow, LargeHeader, Screen, Section, TextScale, Txt } from "@/src/ui";
import { BigNumber, Countdown, DocTile, IconRow, MOVE_IN_STEPS, MOVE_OUT_STEPS, MoneyCard, More, PersonChip, PhotoPair, REPAIR_STEPS, SIGN_STEPS, Status, StripCard, TimeChoice, Tracker, YesNo, burst } from "@/src/visual";
import { Kind, Role, statusOf } from "@/src/status";
import { setColorScheme, spacing, useTheme } from "@/src/theme";
import FIX from "@/src/status.fixture.json";

const KINDS: Kind[] = ["good", "waiting", "you", "none"];

/** Test 5: statusOf returns one of the 4 kinds for every status in the shared fixture, and matches it. */
export function checkStatusFixture() {
  const bad: string[] = [];
  let n = 0;
  for (const typ of ["ticket", "rent", "lease", "moveout", "approval"] as const) {
    for (const [s, roles] of Object.entries((FIX as any)[typ])) {
      for (const [role, want] of Object.entries(roles as any)) {
        n++;
        const ent = typ === "rent" ? { status: s } : { status: s };
        const got = statusOf(ent, role as Role, typ);
        if (!got || !KINDS.includes(got.kind) || !got.label) bad.push(`${typ}.${s}.${role}: undefined`);
        else if (got.kind !== want) bad.push(`${typ}.${s}.${role}: ${got.kind} ≠ ${want}`);
      }
    }
  }
  return { n, bad };
}

export default function VisualQA() {
  const router = useRouter();
  const { scheme } = useTheme();
  const [scale, setScale] = useState(1);
  const [slot, setSlot] = useState<string | null>(null);
  const [yn, setYn] = useState<"yes" | "no" | null>(null);
  const fx = checkStatusFixture();
  const soon = (d: number, h: number) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  return (
    <Screen testID="visual-qa-screen">
      <LargeHeader title="Visual QA" subtitle="Every building block, every state" back={() => router.back()} />
      <ChipRow>
        <Chip testID="qa-light" label="Light" icon="sunny" selected={scheme === "light"} onPress={() => setColorScheme("light")} />
        <Chip testID="qa-dark" label="Dark" icon="moon" selected={scheme === "dark"} onPress={() => setColorScheme("dark")} />
        <Chip testID="qa-text-normal" label="Text 1×" selected={scale === 1} onPress={() => setScale(1)} />
        <Chip testID="qa-text-large" label="Text 1.6×" selected={scale === 1.6} onPress={() => setScale(1.6)} />
      </ChipRow>
      <TextScale.Provider value={scale}>
        <Section title="Status check" testID="qa-status-check">
          <StripCard kind={fx.bad.length ? "you" : "good"}>
            <Status testID="qa-fixture-result" kind={fx.bad.length ? "you" : "good"} label={fx.bad.length ? `${fx.bad.length} of ${fx.n} wrong` : `All ${fx.n} statuses map`} />
            {fx.bad.map((b) => <Txt key={b} v="small">{b}</Txt>)}
          </StripCard>
        </Section>
        <Section title="Status">
          <Card style={{ gap: spacing.md }}>
            <Status kind="good" label="Paid" /><Status kind="waiting" label="Booked Thu 3 pm" /><Status kind="you" label="Needs your OK" /><Status kind="none" label="Empty" />
          </Card>
          {KINDS.map((k) => <StripCard key={k} kind={k}><Status kind={k} label={k} size="sm" /></StripCard>)}
        </Section>
        <Section title="BigNumber">
          <Card style={{ gap: spacing.md }}>
            <BigNumber value={1200} caption="Rent due Nov 1" />
            <BigNumber value={2450} sign="in" caption="Collected" />
            <BigNumber value={140} sign="out" caption="Dryer repair" />
            <BigNumber value={1200} sign="held" caption="Deposit held" />
          </Card>
        </Section>
        <Section title="Tracker">
          <Card style={{ gap: spacing.lg }}>
            <Tracker steps={REPAIR_STEPS} current={1} />
            <Tracker steps={REPAIR_STEPS} current={3} mine />
            <Tracker steps={REPAIR_STEPS} current={5} />
            <Tracker steps={REPAIR_STEPS} current={2} compact />
            <Tracker steps={MOVE_OUT_STEPS} current={2} />
            <Tracker steps={MOVE_IN_STEPS} current={1} mine />
            <Tracker steps={SIGN_STEPS} current={1} mine />
          </Card>
        </Section>
        <Section title="People, times, yes / no">
          <Card style={{ gap: spacing.md }}>
            <PersonChip name="Hank Miller" rating={4.8} trade="plumbing" />
            <TimeChoice testIDPrefix="qa-time" slots={[{ iso: soon(1, 15), label: "" }, { iso: soon(2, 10), label: "" }]} picked={slot} onPick={(iso) => { setSlot(iso); burst("Booked"); }} />
            <YesNo testIDPrefix="qa-yn" answered={yn} onYes={() => setYn("yes")} onNo={() => setYn("no")} />
          </Card>
        </Section>
        <Section title="Countdown">
          <Card style={{ gap: spacing.md }}>
            <Countdown days={18} caption="Refund due Nov 20" /><Countdown days={3} caption="Move-out in 3 days" /><Countdown days={-2} caption="Rent is late" />
          </Card>
        </Section>
        <Section title="MoneyCard">
          <MoneyCard testID="qa-money" amount={140} sign="out" what="Dryer repair · Hank" kind="you" statusLabel="Needs your OK" action="OK to pay" onAction={() => burst("Paid")}
            more={<Txt v="body">Parts $60 · Labor $80</Txt>}>
            <Status kind="good" label="Fair price" size="sm" />
          </MoneyCard>
          <MoneyCard amount={1200} what="Deposit refund" kind="good" statusLabel="Refunded" sign="in" />
        </Section>
        <Section title="PhotoPair">
          <PhotoPair before={null} after={null} box={{ x: 0.3, y: 0.3, w: 0.4, h: 0.3 }} />
        </Section>
        <Section title="Docs, rows, more">
          <DocTile name="Lease" onView={() => {}} shareUrl="https://example.com/lease.pdf" />
          <DocTile name="Receipt Nov" icon="receipt" onView={() => {}} />
          <Card>
            <IconRow icon="cash" label="Rent" value="$1,200" /><IconRow icon="calendar" label="Due day" value="1" /><IconRow icon="lock-closed" label="Deposit" value="$1,200" />
            <More><Txt v="body">Hidden details open in place.</Txt></More>
          </Card>
        </Section>
        <View style={{ height: spacing.xxl }} />
      </TextScale.Provider>
    </Screen>
  );
}
