import { runContainer } from '../executor/container-executor';
import type { ContainerPayload, ContainerResult } from '@flaxia/sdk';

export const handleContainer = async (payload: ContainerPayload): Promise<ContainerResult> => {
  return await runContainer(payload);
};
