/**
 * Programmable Mock Provider Adapter for ReAct Loop Testing.
 */

import type { ProviderDelta } from "@nanoforge/protocol";
import type { CancellationToken } from "../../cancellation/types";
import { BaseProviderAdapter } from "../../providers/base";
import type { ChatRequest, ProviderCapabilities } from "../../providers/types";

export class MockProviderAdapter extends BaseProviderAdapter {
  readonly id = "mock";
  readonly defaultModel = "mock-model";
  readonly capabilities: ProviderCapabilities = {
    planning: true,
    coding: true,
    vision: true,
    toolCalling: true,
    promptCaching: true,
    extendedThinking: true,
  };

  private _scriptedResponses: ProviderDelta[][] = [];
  private _currentTurn = 0;
  public recordedRequests: ChatRequest[] = [];

  constructor(responses: ProviderDelta[][] = []) {
    super();
    this._scriptedResponses = responses;
  }

  setResponses(responses: ProviderDelta[][]): void {
    this._scriptedResponses = responses;
    this._currentTurn = 0;
  }

  addResponse(deltas: ProviderDelta[]): void {
    this._scriptedResponses.push(deltas);
  }

  async *streamChat(
    request: ChatRequest,
    token?: CancellationToken
  ): AsyncIterable<ProviderDelta> {
    token?.throwIfCancelled();
    this.recordedRequests.push(request);

    const deltas = this._scriptedResponses[this._currentTurn] || [
      { type: "text", text: "Default mock response." },
      { type: "done", finishReason: "stop" },
    ];
    this._currentTurn++;

    for (const delta of deltas) {
      token?.throwIfCancelled();
      yield delta;
    }
  }

  reset(): void {
    this._currentTurn = 0;
    this.recordedRequests = [];
  }
}
