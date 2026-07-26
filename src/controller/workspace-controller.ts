import type { ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import {
  createRuntimeState,
  addServiceToRuntimeState,
  getSelectedService,
  selectNextService,
  selectPreviousService,
  updateServiceProcessState,
  type RuntimeWorkspaceState,
} from "../runtime/runtime-state.js";

type MaybePromise<T> = T | Promise<T>;

export type WorkspaceProcessManager = {
  start(service: ServiceConfig): MaybePromise<ManagedProcessState>;
  stop(serviceId: string): Promise<ManagedProcessState>;
  restart(service: ServiceConfig): Promise<ManagedProcessState>;
  getLogs(serviceId: string): ServiceLogEntry[];
  stopAll(): Promise<void>;
};

export type WorkspaceControllerOptions = {
  workspace: WorkspaceConfig;
  processManager: WorkspaceProcessManager;
};

export class WorkspaceController {
  private state: RuntimeWorkspaceState;
  private readonly processManager: WorkspaceProcessManager;

  constructor(options: WorkspaceControllerOptions) {
    this.state = createRuntimeState(options.workspace);
    this.processManager = options.processManager;
  }

  getState(): RuntimeWorkspaceState {
    return this.state;
  }

  async startAutoStartServices(): Promise<void> {
    const services = this.state.services
      .map((serviceState) => serviceState.service)
      .filter((service) => service.autoStart);

    await Promise.all(services.map((service) => this.startService(service.id)));
  }

  async startService(serviceId: string): Promise<ManagedProcessState> {
    const service = this.findService(serviceId);

    if (service === undefined) {
      return { status: "stopped" };
    }

    const processState = await this.runProcessAction(serviceId, () =>
      this.processManager.start(service),
    );

    return processState;
  }

  async stopService(serviceId: string): Promise<ManagedProcessState> {
    if (this.findService(serviceId) === undefined) {
      return { status: "stopped" };
    }

    const processState = await this.runProcessAction(serviceId, () =>
      this.processManager.stop(serviceId),
    );

    return processState;
  }

  async restartService(serviceId: string): Promise<ManagedProcessState> {
    const service = this.findService(serviceId);

    if (service === undefined) {
      return { status: "stopped" };
    }

    const processState = await this.runProcessAction(serviceId, () =>
      this.processManager.restart(service),
    );

    return processState;
  }

  async startSelectedService(): Promise<ManagedProcessState> {
    const selectedService = getSelectedService(this.state);

    if (selectedService === undefined) {
      return { status: "stopped" };
    }

    return this.startService(selectedService.service.id);
  }

  addService(service: ServiceConfig): RuntimeWorkspaceState {
    this.state = addServiceToRuntimeState(this.state, service);

    return this.state;
  }

  async stopSelectedService(): Promise<ManagedProcessState> {
    const selectedService = getSelectedService(this.state);

    if (selectedService === undefined) {
      return { status: "stopped" };
    }

    return this.stopService(selectedService.service.id);
  }

  async restartSelectedService(): Promise<ManagedProcessState> {
    const selectedService = getSelectedService(this.state);

    if (selectedService === undefined) {
      return { status: "stopped" };
    }

    return this.restartService(selectedService.service.id);
  }

  selectNextService(): RuntimeWorkspaceState {
    this.state = selectNextService(this.state);

    return this.state;
  }

  selectPreviousService(): RuntimeWorkspaceState {
    this.state = selectPreviousService(this.state);

    return this.state;
  }

  getServiceLogs(serviceId: string): ServiceLogEntry[] {
    if (this.findService(serviceId) === undefined) {
      return [];
    }

    return this.processManager.getLogs(serviceId);
  }

  getSelectedServiceLogs(): ServiceLogEntry[] {
    const selectedService = getSelectedService(this.state);

    if (selectedService === undefined) {
      return [];
    }

    return this.getServiceLogs(selectedService.service.id);
  }

  async shutdown(): Promise<void> {
    await this.processManager.stopAll();
  }

  private findService(serviceId: string): ServiceConfig | undefined {
    const index = this.state.serviceIndexById[serviceId];

    if (index === undefined) {
      return undefined;
    }

    return this.state.services[index]?.service;
  }

  private async runProcessAction(
    serviceId: string,
    action: () => MaybePromise<ManagedProcessState>,
  ): Promise<ManagedProcessState> {
    try {
      const processState = await action();
      this.state = updateServiceProcessState(this.state, serviceId, processState);

      return processState;
    } catch (error) {
      const processState: ManagedProcessState = {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
      this.state = updateServiceProcessState(this.state, serviceId, processState);

      return processState;
    }
  }
}
