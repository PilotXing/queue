import { ButtonLayoutManager } from '../managers/ButtonLayoutManager';

export class DraggableButton {
    public containerEl: HTMLElement;
    private manager: ButtonLayoutManager;
    private buttonId: string;
    
    private isDragging = false;
    private isLongPress = false;
    private pressTimer: any = null;

    private startX = 0;
    private startY = 0;
    private currentX = 0;
    private currentY = 0;
    
    private initialPointerX = 0;
    private initialPointerY = 0;

    constructor(parent: HTMLElement, manager: ButtonLayoutManager, id: string, text: string, cls: string, onClick: () => void) {
        this.manager = manager;
        this.buttonId = id;

        this.containerEl = parent.createEl('button', { text, cls: `draggable-btn ${cls}` });
        this.containerEl.style.position = 'absolute';
        this.containerEl.style.zIndex = '50';
        this.containerEl.style.cursor = 'pointer';

        const pos = this.manager.getPosition(id);
        if (pos) {
            this.currentX = pos.x;
            this.currentY = pos.y;
            this.updateTransform();
        }

        this.containerEl.onclick = (e) => {
            onClick();
        };

        this.containerEl.addEventListener('pointerdown', this.onPointerDown);
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

    private onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return; // Only left click / touch
        
        this.isLongPress = false;
        this.initialPointerX = e.clientX;
        this.initialPointerY = e.clientY;

        this.pressTimer = setTimeout(() => {
            this.isLongPress = true;
            this.startDragging(e);
        }, 500);

        window.addEventListener('pointermove', this.onPointerMoveWindow);
        window.addEventListener('pointerup', this.onPointerUpWindow);
        window.addEventListener('pointercancel', this.onPointerUpWindow);
    }

    private startDragging(e: PointerEvent) {
        this.isDragging = true;
        this.containerEl.style.cursor = 'grabbing';
        this.containerEl.addClass('is-dragging');
        
        let transformMatches = this.containerEl.style.transform.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
        if (transformMatches) {
            this.currentX = parseFloat(transformMatches[1]);
            this.currentY = parseFloat(transformMatches[2]);
        }
        
        this.startX = this.initialPointerX - this.currentX;
        this.startY = this.initialPointerY - this.currentY;
    }

    private onPointerMoveWindow = (e: PointerEvent) => {
        if (!this.isLongPress && this.pressTimer) {
            const dx = Math.abs(e.clientX - this.initialPointerX);
            const dy = Math.abs(e.clientY - this.initialPointerY);
            if (dx > 8 || dy > 8) {
                clearTimeout(this.pressTimer);
                this.pressTimer = null;
            }
        } else if (this.isDragging) {
            this.currentX = e.clientX - this.startX;
            this.currentY = e.clientY - this.startY;
            this.updateTransform();
        }
    }

    private onPointerUpWindow = async (e: PointerEvent) => {
        if (this.pressTimer) {
            clearTimeout(this.pressTimer);
            this.pressTimer = null;
        }
        
        window.removeEventListener('pointermove', this.onPointerMoveWindow);
        window.removeEventListener('pointerup', this.onPointerUpWindow);
        window.removeEventListener('pointercancel', this.onPointerUpWindow);

        if (this.isDragging) {
            this.isDragging = false;
            this.containerEl.style.cursor = 'pointer';
            this.containerEl.removeClass('is-dragging');
            
            await this.manager.savePosition(this.buttonId, this.currentX, this.currentY);
            
            // Prevent the click event that usually fires immediately after dragging
            const preventClick = (evt: MouseEvent) => {
                evt.stopPropagation();
                evt.preventDefault();
                this.containerEl.removeEventListener('click', preventClick, true);
            };
            this.containerEl.addEventListener('click', preventClick, true);
            setTimeout(() => this.containerEl.removeEventListener('click', preventClick, true), 100);
        }
    }

    private updateTransform() {
        this.containerEl.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
    }
}
