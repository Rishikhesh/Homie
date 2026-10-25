import { RoleTabs } from "@/src/tabs";

export default function TenantTabs() {
  return (
    <RoleTabs tabs={[
      { name: "index", label: "Home", icon: "home", sf: "house.fill" },
      { name: "chat", label: "Chat", icon: "chatbubbles", sf: "bubble.left.and.bubble.right.fill" },
      { name: "tickets", label: "Repairs", testID: "tab-tickets", icon: "construct", sf: "wrench.and.screwdriver.fill" },
      { name: "payments", label: "Payments", icon: "wallet", sf: "dollarsign.circle.fill" },
    ]} />
  );
}
