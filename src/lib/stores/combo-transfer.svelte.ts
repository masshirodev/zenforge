export interface ComboNodeEntry {
	name: string;
	gpcCode: string;
}

export interface ComboTransfer {
	comboName: string;
	gpcCode: string;
	returnTo: string | null; // game path to write combo file into
	/** When true, create gameplay flow node(s) instead of writing a .gpc file */
	createNodes?: boolean;
	/** Individual combo entries for node creation (one node per entry, or all in one) */
	nodeEntries?: ComboNodeEntry[];
}

let transfer = $state<ComboTransfer | null>(null);

export function getComboTransfer(): ComboTransfer | null {
	return transfer;
}

export function setComboTransfer(data: ComboTransfer): void {
	transfer = data;
}

export function clearComboTransfer(): void {
	transfer = null;
}
