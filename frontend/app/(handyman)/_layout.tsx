import React from "react";
import { RoleTabs } from "@/src/tabs";

export default function HandymanTabs() {
  return (
    <RoleTabs tabs={[
      { name: "index", label: "Jobs", icon: "hammer", sf: "hammer.fill" },
      { name: "profile", label: "Profile", icon: "person-circle", sf: "person.crop.circle.fill" },
    ]} />
  );
}
