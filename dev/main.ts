import { fleetAnalyticsDashboard } from '../src/addin';
import { createMockApi, mockState } from './mock-api';

fleetAnalyticsDashboard().initialize(createMockApi(), mockState, () => {
  console.log('[dev] dashboard initialized with mock data');
});
