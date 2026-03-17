import { ButtonLayoutManager } from '../managers/ButtonLayoutManager';

export class DraggableButton {
    public containerEl: HTMLElement;
    private manager: ButtonLayoutManager;
    private buttonId: string;
    
    private isDragging = false;
    private startX = 0;
    private startY = 0;
    private currentX = 0;
    private currentY = 0;

    constructor(parent: HTMLElement, manager: ButtonLayoutManager, id: string, text: string, cls: string, onClick: () => void) {
        this.manager = manager;
        this.buttonId = id;

        this.containerEl = parent.createEl('button', { text, cls: `draggable-btn ${cls}` });
        this.containerEl.style.position = 'absolute'; // Ensure it can float freely
        this.containerEl.style.zIndex = '50';

        // Load position if saved
        const pos = this.manager.getPosition(id);
        if (pos) {
            this.currentX = pos.x;
            this.currentY = pos.y;
            this.updateTransform();
        }

        this.updateModeStyles();

        // Standard Click Handler
        this.containerEl.onclick = (e) => {
            if (this.manager.isUnlocked) {
                e.preventDefault();
                e.stopPropagation();
                return; // Disabled in edit mode
            }
            onClick();
        };

        // Pointer Events for Dragging
        this.containerEl.addEventListener('pointerdown', this.onPointerDown.bind(this));
    }

    public updateModeStyles() {
        if (this.manager.isUnlocked) {
            this.containerEl.addClass('is-unlocked');
            this.containerEl.style.cursor = 'grab';
        } else {
            this.containerEl.removeClass('is-unlocked');
            this.containerEl.style.cursor = 'pointer';
        }
    }

    public setText(text: string) {
        this.containerEl.setText(text);
    }

    public hide() {
        this.containerEl.style.display = 'none';
    }

    public show() {
        this.containerEl.style.display = '';
    }

    private onPointerDown(e: PointerEvent) {
        if (!this.manager.isUnlocked) return;
        
        this.isDragging = true;
        this.containerEl.style.cursor = 'grabbing';
        this.containerEl.setPointerCapture(e.pointerId);

        let transformMatches = this.containerEl.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)/);
        if (transformMatches) {
            this.currentX = parseFloat(transformMatches[1]);
            this.currentY = parseFloat(transformMatches[2]);
        }

        this.startX = e.clientX - this.currentX;
        this.startY = e.clientY - this.currentY;

        this.containerEl.addEventListener('pointermove', this.onPointerMove);
        this.containerEl.addEventListener('pointerup', this.onPointerUp);
        this.containerEl.addEventListener('pointercancel', this.onPointerUp);
    }

    private onPointerMove = (e: PointerEvent) => {
        if (!this.isDragging) return;
        
        this.currentX = e.clientX - this.startX;
        this.currentY = e.clientY - this.startY;
        this.updateTransform();
    }

    private onPointerUp = async (e: PointerEvent) => {
        this.isDragging = false;
        this.containerEl.style.cursor = 'grab';
        this.containerEl.releasePointerCapture(e.pointerId);

        this.containerEl.removeEventListener('pointermove', this.onPointerMove);
        this.containerEl.removeEventListener('pointerup', this.onPointerUp);
        this.containerEl.removeEventListener('pointercancel', this.onPointerUp);

        await this.manager.savePosition(this.buttonId, this.currentX, this.currentY);
    }

    private updateTransform() {
        this.containerEl.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
    }
}
