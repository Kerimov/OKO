/**
 * Self-test for NSI perimeter helpers and non-destructive kontr import shape.
 * Run: npx tsx src/nsiPerimeter.selftest.ts
 */
import assert from "node:assert/strict";
import { sectionsFromVersion } from "./nsiPerimeter.js";

const sections = sectionsFromVersion({
  id: 1,
  kontrId: 10,
  guid: "g-1",
  versionNo: 1,
  validFrom: "2024-01-01",
  validTo: null,
  name: "АО Тест",
  oldName: null,
  inn: "7700000000",
  kpp: "770001001",
  ogrn: null,
  orgForm: "АО",
  orgType: 1,
  mandatoryRash: true,
  country: "RU",
  city: "Москва",
  idObdnsi: null,
  card: { perimeter: { confidentiality: "normal", department: "fin" } },
  createdAt: "2024-01-01T00:00:00.000Z",
  createdBy: null,
});

assert.equal(sections.basic.name, "АО Тест");
assert.equal(sections.requisites.inn, "7700000000");
assert.equal(sections.perimeter.confidentiality, "normal");

console.log("nsiPerimeter.selftest: OK");
