import { GoogleAuth } from "google-auth-library";
import {
  FleetTaskPlanResponseSchema,
  CloudSummaryResponseSchema,
  type FleetTaskDecompositionRequestV1,
  type FleetTaskPlanResponse,
  type CloudSummaryRequestV1,
  type CloudSummaryResponse
} from "@belay/contracts";

export interface CloudSummaryAdapter {
  readonly provider: string;
  summarize(
    payload: CloudSummaryRequestV1,
    options: { requestId: string; timeoutMilliseconds: number }
  ): Promise<CloudSummaryResponse>;
  decomposeFleetTask?(
    payload: FleetTaskDecompositionRequestV1,
    options: { requestId: string; timeoutMilliseconds: number }
  ): Promise<FleetTaskPlanResponse>;
}

export class CloudRunSummaryAdapter implements CloudSummaryAdapter {
  readonly provider = "google-cloud-run";
  private readonly auth = new GoogleAuth();
  private readonly serviceUrl: string;

  constructor(serviceUrl: string) {
    const parsed = new URL(serviceUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("The Cloud Run intelligence URL must use HTTPS.");
    }
    this.serviceUrl = parsed.href.replace(/\/$/u, "");
  }

  async summarize(
    payload: CloudSummaryRequestV1,
    options: { requestId: string; timeoutMilliseconds: number }
  ): Promise<CloudSummaryResponse> {
    const client = await this.auth.getIdTokenClient(this.serviceUrl);
    const response = await client.request({
      url: `${this.serviceUrl}/v1/summarize`,
      method: "POST",
      headers: { "x-belay-request-id": options.requestId },
      data: payload,
      timeout: options.timeoutMilliseconds,
      responseType: "json"
    });
    return CloudSummaryResponseSchema.parse(response.data);
  }

  async decomposeFleetTask(
    payload: FleetTaskDecompositionRequestV1,
    options: { requestId: string; timeoutMilliseconds: number }
  ): Promise<FleetTaskPlanResponse> {
    const client = await this.auth.getIdTokenClient(this.serviceUrl);
    const response = await client.request({
      url: `${this.serviceUrl}/v1/decompose-fleet-task`,
      method: "POST",
      headers: { "x-belay-request-id": options.requestId },
      data: payload,
      timeout: options.timeoutMilliseconds,
      responseType: "json"
    });
    return FleetTaskPlanResponseSchema.parse(response.data);
  }
}
