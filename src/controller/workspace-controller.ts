import type { CommandConfig, ServiceConfig, WorkspaceConfig } from "../config/config-types.js";
import type { ManagedProcessState, ServiceLogEntry } from "../process/process-manager.js";
import {
  createRuntimeState,
  addServiceToRuntimeState,
  addCommandToRuntimeState,
  getSelectedCommand,
  getSelectedService,
  moveServiceInRuntimeState,
  removeServiceFromRuntimeState,
  removeCommandFromRuntimeState,
  selectNextService,
  selectPreviousService,
  updateCommandConfigInRuntimeState,
  updateServiceConfigInRuntimeState,
  updateCommandProcessState,
  updateServiceProcessState,
  type RuntimeWorkspaceState,
} from "../runtime/runtime-state.js";

type MaybePromise<T> = T | Promise<T>;

export type WorkspaceProcessManager = {
  start(service: ServiceConfig | CommandConfig): MaybePromise<ManagedProcessState>;
  stop(serviceId: string): Promise<ManagedProcessState>;
  restart(service: ServiceConfig | CommandConfig): Promise<ManagedProcessState>;
  getLogs(serviceId: string): ServiceLogEntry[];
  getState(serviceId: string): ManagedProcessState;
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
    this.syncProcessStates();

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
    const selectedCommand = getSelectedCommand(this.state);

    if (selectedService === undefined && selectedCommand === undefined) {
      return { status: "stopped" };
    }

    if (selectedCommand !== undefined) {
      return this.startCommand(selectedCommand.command.id);
    }

    return this.startService(selectedService!.service.id);
  }

  async startCommand(commandId: string): Promise<ManagedProcessState> {
    const command = this.findCommand(commandId);

    if (command === undefined) {
      return { status: "stopped" };
    }

    return this.runCommandProcessAction(commandId, () =>
      this.processManager.start(command),
    );
  }

  addService(service: ServiceConfig): RuntimeWorkspaceState {
    this.state = addServiceToRuntimeState(this.state, service);

    return this.state;
  }

  addCommand(command: CommandConfig): RuntimeWorkspaceState {
    this.state = addCommandToRuntimeState(this.state, command);

    return this.state;
  }

  updateService(service: ServiceConfig): RuntimeWorkspaceState {
    this.state = updateServiceConfigInRuntimeState(this.state, service);

    return this.state;
  }

  updateCommand(command: CommandConfig): RuntimeWorkspaceState {
    this.state = updateCommandConfigInRuntimeState(this.state, command);

    return this.state;
  }

  removeService(serviceId: string): RuntimeWorkspaceState {
    this.state = removeServiceFromRuntimeState(this.state, serviceId);

    return this.state;
  }

  removeCommand(commandId: string): RuntimeWorkspaceState {
    this.state = removeCommandFromRuntimeState(this.state, commandId);

    return this.state;
  }

  moveService(serviceId: string, direction: "up" | "down"): RuntimeWorkspaceState {
    this.state = moveServiceInRuntimeState(this.state, serviceId, direction);

    return this.state;
  }

  async stopSelectedService(): Promise<ManagedProcessState> {
    const selectedService = getSelectedService(this.state);
    const selectedCommand = getSelectedCommand(this.state);

    if (selectedService === undefined && selectedCommand === undefined) {
      return { status: "stopped" };
    }

    if (selectedCommand !== undefined) {
      return this.stopCommand(selectedCommand.command.id);
    }

    return this.stopService(selectedService!.service.id);
  }

  async stopCommand(commandId: string): Promise<ManagedProcessState> {
    if (this.findCommand(commandId) === undefined) {
      return { status: "stopped" };
    }

    return this.runCommandProcessAction(commandId, () =>
      this.processManager.stop(commandId),
    );
  }

  async restartSelectedService(): Promise<ManagedProcessState> {
    const selectedService = getSelectedService(this.state);
    const selectedCommand = getSelectedCommand(this.state);

    if (selectedService === undefined && selectedCommand === undefined) {
      return { status: "stopped" };
    }

    if (selectedCommand !== undefined) {
      return this.startCommand(selectedCommand.command.id);
    }

    return this.restartService(selectedService!.service.id);
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
    const selectedCommand = getSelectedCommand(this.state);

    if (selectedService === undefined && selectedCommand === undefined) {
      return [];
    }

    if (selectedCommand !== undefined) {
      return this.getCommandLogs(selectedCommand.command.id);
    }

    return this.getServiceLogs(selectedService!.service.id);
  }

  getCommandLogs(commandId: string): ServiceLogEntry[] {
    if (this.findCommand(commandId) === undefined) {
      return [];
    }

    return this.processManager.getLogs(commandId);
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

  private syncProcessStates(): void {
    for (const serviceState of this.state.services) {
      this.state = updateServiceProcessState(
        this.state,
        serviceState.service.id,
        this.processManager.getState(serviceState.service.id),
      );
    }

    for (const commandState of this.state.commands) {
      this.state = updateCommandProcessState(
        this.state,
        commandState.command.id,
        this.processManager.getState(commandState.command.id),
      );
    }
  }

  private findCommand(commandId: string): CommandConfig | undefined {
    const index = this.state.commandIndexById[commandId];

    if (index === undefined) {
      return undefined;
    }

    return this.state.commands[index]?.command;
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

  private async runCommandProcessAction(
    commandId: string,
    action: () => MaybePromise<ManagedProcessState>,
  ): Promise<ManagedProcessState> {
    try {
      const processState = await action();
      this.state = updateCommandProcessState(this.state, commandId, processState);

      return processState;
    } catch (error) {
      const processState: ManagedProcessState = {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
      this.state = updateCommandProcessState(this.state, commandId, processState);

      return processState;
    }
  }
}
