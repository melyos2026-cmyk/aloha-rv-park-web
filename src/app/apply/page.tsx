"use client";
import { useState } from "react";

export default function ApplyPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    currentAddress: "", city: "", state: "", zip: "",
    rvMake: "", rvModel: "", rvYear: "", rvLength: "",
    adults: "", children: "", pets: "", petDescription: "",
    stayType: "monthly", arrivalDate: "", emergencyName: "", emergencyPhone: "",
    agreeRules: false, agreeBackground: false
  });

  const update = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  return <div><h1>Apply Page - Coming Soon</h1></div>;
}
