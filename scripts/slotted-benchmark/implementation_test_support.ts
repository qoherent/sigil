import { deepStrictEqual as equal } from "node:assert/strict";
import { join } from "node:path";
const binary =
  new URL("../../packages/sigilc/target/debug/sigilc", import.meta.url)
    .pathname;

export async function native(
  root: string,
  store: string,
  args: string[],
  exit = 0,
) {
  const output = await new Deno.Command(binary, {
    args: [...args, "--root", root, "--store", store],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(output.stdout);
  equal(output.code, exit, new TextDecoder().decode(output.stderr) + text);
  return JSON.parse(text);
}
export async function cannedDesign(
  root: string,
  store: string,
  scratch: string,
) {
  const out = join(scratch, "design");
  await native(root, store, [
    "prepare",
    "--source",
    "slotted.sigil",
    "--out",
    out,
  ]);
  const request = JSON.parse(
    await Deno.readTextFile(join(out, "request.json")),
  );
  const rows: string[] = [];
  for (const f of request.rows) {
    if (f.context) continue;
    const id = JSON.stringify(f.facet);
    if (f.prose.includes("Booking provides a *booking request*")) {
      rows.push(
        `(claim ${id} "Booking" "provides" "booking request" "required" "true")`,
      );
    } else if (f.prose.includes("Booking provides a *range change*")) {
      rows.push(
        `(claim ${id} "Booking" "provides" "range change" "required" "true")`,
      );
    } else if (f.prose.includes("at most 7 days")) {
      rows.push(
        `(measure ${id} "booking request" "maxDurationDays" "7")`,
        `(measure ${id} "booking request" "maxLeadDays" "180")`,
      );
    } else if (f.prose.includes("Rooms must exclusively own")) {
      rows.push(
        `(claim ${id} "Rooms" "owns" "archived room mark" "required" "true")`,
        `(property ${id} "archived room mark" "exclusive" "true")`,
      );
    } else if (f.prose.includes("Rooms owns and updates")) {
      rows.push(
        `(claim ${id} "Rooms" "owns" "archived room mark" "required" "true")`,
      );
    } else rows.push(`(reading ${id} "no-commitment")`);
  }
  const answer = join(out, "answer.egg");
  await Deno.writeTextFile(answer, rows.join("\n"));
  await native(root, store, [
    "ingest",
    "--binding",
    join(out, "binding.json"),
    "--claims",
    answer,
  ]);
  return await native(root, store, ["check"]);
}
export async function cannedCode(root: string, store: string, scratch: string) {
  const prep = await native(root, store, [
    "align",
    "prepare",
    "--out",
    join(scratch, "code"),
  ]);
  for (const dir of prep.inputs) {
    const binding = JSON.parse(
      await Deno.readTextFile(join(dir, "binding.json")),
    );
    const text = await Deno.readTextFile(join(root, binding.path));
    const rows: string[] = [];
    if (binding.path === "src/booking.ts") {
      rows.push(
        '(element "submitBookingRequest" "function")',
        '(realizes "submitBookingRequest" "Booking")',
        '(realizes "submitBookingRequest" "Booking::booking request")',
        `(measure "submitBookingRequest" "durationDays" "7")`,
        `(measure "submitBookingRequest" "leadDays" "${
          text.includes("leadDays > 365") ? 365 : 180
        }")`,
      );
      if (text.includes("export function changePendingRange")) {
        rows.push(
          '(element "changePendingRange" "function")',
          '(realizes "changePendingRange" "Booking")',
          '(realizes "changePendingRange" "Booking::range change")',
        );
      }
      if (text.includes("countPendingForMarketing")) {
        rows.push('(element "countPendingForMarketing" "function")');
      }
      if (text.includes("traceBooking")) {
        rows.push('(element "traceBooking" "function")');
      }
      if (text.includes('archivedRoomMarks.set("room-owned-by-booking"')) {
        rows.push(
          '(act "submitBookingRequest" "owns" "Rooms::archived room mark")',
        );
      }
    } else if (binding.path === "src/rooms.ts") {
      rows.push(
        '(element "archivedRoomMarks" "state")',
        '(realizes "archivedRoomMarks" "Rooms")',
        '(act "archivedRoomMarks" "owns" "Rooms::archived room mark")',
        '(element "markRoomArchived" "function")',
        '(realizes "markRoomArchived" "Rooms")',
        '(act "markRoomArchived" "owns" "Rooms::archived room mark")',
      );
    } else if (binding.path === "src/booking-plumbing.ts") {
      rows.push('(element "traceBooking" "function")');
    } else rows.push('(element "exportRenterContacts" "function")');
    const answer = join(dir, "answer.egg");
    await Deno.writeTextFile(answer, rows.join("\n"));
    await native(root, store, [
      "align",
      "ingest",
      "--binding",
      join(dir, "binding.json"),
      "--claims",
      answer,
    ]);
  }
}
