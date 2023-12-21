export const EventQueue: EventData[] = [];

export interface EventData {
  eventName: string;
  eventArgs: string[];
  block: number;
}
