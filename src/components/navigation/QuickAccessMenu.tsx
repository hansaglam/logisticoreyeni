/**
 * @deprecated Use ManagementPanel directly. Kept for GameTabBar import compatibility.
 */
import ManagementPanel from '../management/ManagementPanel';

export type { ManagementPanelProps as QuickAccessMenuProps } from '../management/ManagementPanel';
export { buildQuickAccessItems } from '../../navigation/quickAccessConfig';

export default ManagementPanel;
