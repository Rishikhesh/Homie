// Admin-only: share your sample Tom, Maria and Hank so other landlords can "Try as" them.
import React, { useState } from "react";
import { Switch, View } from "react-native";
import { api } from "@/src/api";
import { useLive } from "@/src/useLive";
import { Card, Row, Section, StatusPill, Txt, useToast } from "@/src/ui";
import { useTheme } from "@/src/theme";

export function SharedDemoSwitch({ onChange }: { onChange?: () => void }) {
  const { colors } = useTheme();
  const toast = useToast();
  const { data, reload } = useLive<any>(() => api("/admin/shared-demo"), 0);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const flip = async (on: boolean) => {
    setBusy(true);
    try { await api("/admin/shared-demo", { body: { on } }); toast(on ? "Shared demo is on" : "Shared demo is off"); reload(); onChange?.(); }
    catch (e: any) { toast(e.message, "error"); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Admin" testID="admin-section" right={<StatusPill label="Admin" tone="brand" />}>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Txt v="label">Shared demo</Txt>
            <Txt v="small">Other landlords can try as your Tom, Maria and Hank</Txt>
          </View>
          <Switch testID="shared-demo-switch" value={!!data.on} disabled={busy} onValueChange={flip}
            trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.surfaceSecondary} />
        </Row>
      </Card>
    </Section>
  );
}
