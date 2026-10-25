import { RoleTabs } from "@/src/tabs";

export default function LandlordTabs() {
  return (
    <RoleTabs tabs={[
      { name: "index", label: "Home", icon: "home", sf: "house.fill" },
      { name: "tickets", label: "Repairs", testID: "tab-tickets", icon: "construct", sf: "wrench.and.screwdriver.fill" },
      { name: "properties", label: "Homes", testID: "tab-properties", icon: "business", sf: "building.2.fill" },
      { name: "handymen", label: "Handymen", icon: "people", sf: "person.2.fill" },
      { name: "money", label: "Money", icon: "wallet", sf: "dollarsign.circle.fill" },
    ]} />
  );
}
