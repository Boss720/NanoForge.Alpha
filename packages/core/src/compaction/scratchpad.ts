/**
 * Structured XML Scratchpad State & Serializer/Parser.
 *
 * Implements persistent, structured state memory across compaction cycles:
 * goals, milestones, hypotheses, and active modified workspace files.
 */

import { escapeXml, unescapeXml } from "../prompt/xmlFormatter";

export type MilestoneStatus = "pending" | "in_progress" | "completed" | "failed";

export interface Milestone {
  id: string;
  title: string;
  status: MilestoneStatus;
}

export interface Hypothesis {
  id: string;
  text: string;
  verified: boolean;
}

export type FileMutationStatus = "clean" | "dirty" | "deleted";

export interface ActiveFileState {
  path: string;
  status: FileMutationStatus;
}

export interface ScratchpadState {
  version: "1.0";
  goal: string;
  milestones: Milestone[];
  hypotheses: Hypothesis[];
  activeFiles: ActiveFileState[];
}

export function createEmptyScratchpad(goal = ""): ScratchpadState {
  return {
    version: "1.0",
    goal,
    milestones: [],
    hypotheses: [],
    activeFiles: [],
  };
}

export function serializeScratchpad(state: ScratchpadState): string {
  const milestonesXml = state.milestones
    .map(
      (m) =>
        `    <milestone id="${escapeXml(m.id)}" status="${escapeXml(m.status)}">${escapeXml(m.title)}</milestone>`
    )
    .join("\n");

  const hypothesesXml = state.hypotheses
    .map(
      (h) =>
        `    <hypothesis id="${escapeXml(h.id)}" verified="${h.verified ? "true" : "false"}">${escapeXml(h.text)}</hypothesis>`
    )
    .join("\n");

  const filesXml = state.activeFiles
    .map(
      (f) =>
        `    <file path="${escapeXml(f.path)}" status="${escapeXml(f.status)}" />`
    )
    .join("\n");

  return [
    `<scratchpad version="1.0">`,
    `  <goal>${escapeXml(state.goal)}</goal>`,
    `  <milestones>`,
    milestonesXml,
    `  </milestones>`,
    `  <hypotheses>`,
    hypothesesXml,
    `  </hypotheses>`,
    `  <active_files>`,
    filesXml,
    `  </active_files>`,
    `</scratchpad>`,
  ].join("\n");
}

export function parseScratchpad(xml: string): ScratchpadState | null {
  if (!xml || typeof xml !== "string") return null;

  const scratchpadMatch = xml.match(/<scratchpad(?:\s+version="([^"]*)")?>([\s\S]*?)<\/scratchpad>/i);
  if (!scratchpadMatch) return null;

  const body = scratchpadMatch[2];

  // Extract goal
  const goalMatch = body.match(/<goal>([\s\S]*?)<\/goal>/i);
  const goal = goalMatch ? unescapeXml(goalMatch[1].trim()) : "";

  // Extract milestones
  const milestones: Milestone[] = [];
  const milestoneRegex = /<milestone\s+id="([^"]*)"\s+status="([^"]*)">([\s\S]*?)<\/milestone>/gi;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = milestoneRegex.exec(body)) !== null) {
    const status = mMatch[2].toLowerCase() as MilestoneStatus;
    milestones.push({
      id: unescapeXml(mMatch[1]),
      status: ["pending", "in_progress", "completed", "failed"].includes(status) ? status : "pending",
      title: unescapeXml(mMatch[3].trim()),
    });
  }

  // Extract hypotheses
  const hypotheses: Hypothesis[] = [];
  const hypothesisRegex = /<hypothesis\s+id="([^"]*)"\s+verified="([^"]*)">([\s\S]*?)<\/hypothesis>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = hypothesisRegex.exec(body)) !== null) {
    hypotheses.push({
      id: unescapeXml(hMatch[1]),
      verified: hMatch[2].toLowerCase() === "true",
      text: unescapeXml(hMatch[3].trim()),
    });
  }

  // Extract active files
  const activeFiles: ActiveFileState[] = [];
  const fileRegex = /<file\s+path="([^"]*)"\s+status="([^"]*)"\s*\/>/gi;
  let fMatch: RegExpExecArray | null;
  while ((fMatch = fileRegex.exec(body)) !== null) {
    const status = fMatch[2].toLowerCase() as FileMutationStatus;
    activeFiles.push({
      path: unescapeXml(fMatch[1]),
      status: ["clean", "dirty", "deleted"].includes(status) ? status : "clean",
    });
  }

  return {
    version: "1.0",
    goal,
    milestones,
    hypotheses,
    activeFiles,
  };
}

export class Scratchpad {
  private _state: ScratchpadState;

  constructor(initialState?: ScratchpadState) {
    this._state = initialState ? { ...initialState } : createEmptyScratchpad();
  }

  static parse(xml: string): Scratchpad | null {
    const parsed = parseScratchpad(xml);
    return parsed ? new Scratchpad(parsed) : null;
  }

  get state(): ScratchpadState {
    return {
      ...this._state,
      milestones: [...this._state.milestones],
      hypotheses: [...this._state.hypotheses],
      activeFiles: [...this._state.activeFiles],
    };
  }

  setGoal(goal: string): void {
    this._state.goal = goal;
  }

  addMilestone(title: string, status: MilestoneStatus = "pending"): string {
    const id = `ms_${this._state.milestones.length + 1}`;
    this._state.milestones.push({ id, title, status });
    return id;
  }

  updateMilestone(id: string, status: MilestoneStatus): boolean {
    const ms = this._state.milestones.find((m) => m.id === id);
    if (ms) {
      ms.status = status;
      return true;
    }
    return false;
  }

  addHypothesis(text: string, verified = false): string {
    const id = `hyp_${this._state.hypotheses.length + 1}`;
    this._state.hypotheses.push({ id, text, verified });
    return id;
  }

  verifyHypothesis(id: string, verified: boolean): boolean {
    const h = this._state.hypotheses.find((hyp) => hyp.id === id);
    if (h) {
      h.verified = verified;
      return true;
    }
    return false;
  }

  trackFile(path: string, status: FileMutationStatus = "dirty"): void {
    const existing = this._state.activeFiles.find((f) => f.path === path);
    if (existing) {
      existing.status = status;
    } else {
      this._state.activeFiles.push({ path, status });
    }
  }

  serialize(): string {
    return serializeScratchpad(this._state);
  }
}
