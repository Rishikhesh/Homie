import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { api, PRESET_PHOTOS } from "@/src/api";
import { BigButton, Chip, Field, LargeHeader, Row, Screen, TextButton, Txt, useToast } from "@/src/ui";
import { PhotoButtons } from "@/src/inputs";
import { radius, spacing, useTheme } from "@/src/theme";

export default function NewProperty() {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [f, setF] = useState<any>({ rental_type: "rooms", photo: "preset:1", utilities: {} });
  const [units, setUnits] = useState<any[]>([{ label: "Room A", rent: "", due_day: "1" }]);
  const [place, setPlace] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const zip = async (z: string) => {
    set("zip", z);
    if (z.length === 5) { try { setPlace(await api(`/zip/${z}`)); } catch (e: any) { toast(e.message, "error"); } }
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, city: place?.city, state: place?.state, units: f.rental_type === "whole" ? [{ label: "Whole home", rent: Number(units[0].rent), due_day: Number(units[0].due_day) }] : units.map((u) => ({ ...u, rent: Number(u.rent), due_day: Number(u.due_day) })) };
      const p = await api("/properties", { body });
      toast("Property added");
      router.replace(`/property/${p.id}`);
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  return (
    <Screen testID="new-property-screen">
      <LargeHeader title="Add a property" back={() => router.back()} />
      <View style={{ gap: spacing.lg }}>
        <Field testID="prop-name-input" label="Name" placeholder="Maple House" value={f.name || ""} onChangeText={(v) => set("name", v)} />
        <Field testID="prop-address-input" label="Street address" placeholder="12 Maple Ave" value={f.address || ""} onChangeText={(v) => set("address", v)} />
        <Field testID="prop-zip-input" label="ZIP" keyboardType="number-pad" maxLength={5} value={f.zip || ""} onChangeText={zip} hint={place ? `${place.city}, ${place.state} · ${place.timezone}` : "City, state and time zone fill in automatically"} />
        <Txt v="label">Photo</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {PRESET_PHOTOS.map((u, i) => (
            <Pressable key={u} testID={`prop-photo-${i}`} onPress={() => set("photo", `preset:${i}`)} style={{ borderRadius: radius.md, borderWidth: 3, borderColor: f.photo === `preset:${i}` ? colors.brandPrimary : "transparent" }}>
              <Image source={{ uri: u }} style={{ width: 96, height: 64, borderRadius: radius.sm }} />
            </Pressable>
          ))}
        </View>
        <PhotoButtons testID="prop-photo-upload" label="Or your own" onUploaded={(id) => set("photo", id)} />
        <Txt v="label">How do you rent it?</Txt>
        <Row>
          <Chip testID="rental-type-whole" label="Whole home" selected={f.rental_type === "whole"} onPress={() => set("rental_type", "whole")} />
          <Chip testID="rental-type-rooms" label="Separate rooms" selected={f.rental_type === "rooms"} onPress={() => set("rental_type", "rooms")} />
        </Row>
        {(f.rental_type === "whole" ? units.slice(0, 1) : units).map((u, i) => (
          <View key={i} style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 0.5, borderColor: colors.border }}>
            {f.rental_type === "rooms" ? <Field testID={`unit-label-${i}`} label="Room name" value={u.label} onChangeText={(v) => setUnits(units.map((x, j) => (j === i ? { ...x, label: v } : x)))} /> : null}
            <Row>
              <View style={{ flex: 1 }}><Field testID={`unit-rent-${i}`} label="Rent ($/mo)" keyboardType="decimal-pad" value={u.rent} onChangeText={(v) => setUnits(units.map((x, j) => (j === i ? { ...x, rent: v } : x)))} /></View>
              <View style={{ width: 110 }}><Field testID={`unit-due-${i}`} label="Due day" keyboardType="number-pad" maxLength={2} value={u.due_day} onChangeText={(v) => setUnits(units.map((x, j) => (j === i ? { ...x, due_day: v } : x)))} /></View>
            </Row>
          </View>
        ))}
        {f.rental_type === "rooms" ? <TextButton testID="add-room-button" icon="add" label="Add a room" onPress={() => setUnits([...units, { label: `Room ${String.fromCharCode(65 + units.length)}`, rent: "", due_day: "1" }])} /> : null}
        <Field testID="prop-rules-input" label="House rules (Homi follows these)" multiline value={f.house_rules || ""} onChangeText={(v) => set("house_rules", v)} placeholder="Quiet hours 10 pm–7 am. No smoking." />
        {["electric", "gas", "internet"].map((k) => <Field key={k} testID={`prop-utility-${k}`} label={`${k[0].toUpperCase() + k.slice(1)} provider`} value={f.utilities[k] || ""} onChangeText={(v) => set("utilities", { ...f.utilities, [k]: v })} />)}
        <BigButton testID="prop-save-button" label="Save property" loading={busy} disabled={!f.name || !f.address || !place || !units[0].rent} onPress={save} />
      </View>
    </Screen>
  );
}
