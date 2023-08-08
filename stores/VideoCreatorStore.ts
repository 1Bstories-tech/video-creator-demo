import {makeAutoObservable, runInAction} from 'mobx';
import {v4 as uuid} from 'uuid';
import {ElementState, Preview, PreviewState} from '@creatomate/preview';
import {groupBy} from '../utility/groupBy';
import {deepClone} from '../utility/deepClone';

type ParentNode = {
    id: string | undefined
    name: string
}
export const getDisplayName = (node?: ElementState | PreviewState) => {
    if (!node || !node.source.id) {
        return {id: undefined, name: 'Main Composition'};
    } else {
        return {id: node.source.id, name: node.source.name || node.source.type};
    }
}

const findPathToNode = (node: ElementState | PreviewState, id: string): ParentNode[] | null => {
    if (node.source.id === id) {
        return [getDisplayName(node)];
    }

    if (node.elements) {
        for (let i = 0; i < node.elements.length; i++) {
            const path = findPathToNode(node.elements[i], id);
            if (path) {
                return [getDisplayName(node), ...path];
            }
        }
    }
    return null;
}


class VideoCreatorStore {
    preview?: Preview = undefined;

    state?: PreviewState = undefined;

    tracks?: Map<number, ElementState[]> = undefined;

    activeElementIds: string[] = [];

    activeParents: ParentNode[] | null = [];

    activeCompositionId?: string = undefined;

    isLoading = true;

    isPlaying = false;

    time = 0;
    previewTime = 0;

    timelineScale = 100;

    isScrubbing = false;

    constructor() {
        makeAutoObservable(this);
    }

    initializeVideoPlayer(htmlElement: HTMLDivElement) {
        if (this.preview) {
            this.preview.dispose();
            this.preview = undefined;
        }

        const preview = new Preview(htmlElement, 'interactive', process.env.NEXT_PUBLIC_VIDEO_PLAYER_TOKEN!);

        this.preview = preview;

        preview.onReady = async () => {
            await preview.setSource(this.getDefaultSource());
        };

        preview.onLoad = async () => {
            runInAction(() => (this.isLoading = true));
        };

        preview.onLoadComplete = async () => {
            runInAction(() => (this.isLoading = false));
        };

        preview.onPlay = () => {
            runInAction(() => (this.isPlaying = true));
        };

        preview.onPause = () => {
            runInAction(() => (this.isPlaying = false));
        };

        preview.onTimeChange = (time) => {
            if (!this.isScrubbing) {
                runInAction(() => (this.time = time));
            }
        };

        preview.onActiveElementsChange = (elementIds) => {
            runInAction(() => (this.activeElementIds = elementIds));
        };

        preview.onActiveCompositionChange = (elementId) => {
            runInAction(() => {
                this.setActiveComposition(elementId);
            })
        };

        preview.onStateChange = (state) => {
            runInAction(() => {
                this.state = state;
                this.updateTracks()
            });
        };
    }

    async setTime(time: number): Promise<void> {
        if (this.activeCompositionId) {
            const activeCompositionElement = this.preview?.findElement((element) => element.source.id === this.activeCompositionId);
            this.time = time;
            if (activeCompositionElement) {
                this.previewTime = activeCompositionElement.globalTime + time;
                await this.preview?.setTime(this.previewTime);
            } else {
                this.previewTime = time;
                await this.preview?.setTime(time);
            }

        } else {
            this.time = time;
            this.previewTime = time;
            await this.preview?.setTime(time);
        }

    }

    async setActiveElements(...elementIds: string[]): Promise<void> {
        this.activeElementIds = elementIds;
        await this.preview?.setActiveElements(elementIds);
    }

    setActiveComposition(elementId: string | null): void {
        this.preview?.setActiveComposition(elementId);
        if (elementId === null) {
            this.activeCompositionId = undefined;
        } else {
            this.activeCompositionId = elementId as string;
        }
        this.activeElementIds = [];
        this.updateTracks()
        this.time = 0
    }

    updateTracks() {
        if (this.activeCompositionId) {
            const activeCompositionElement = this.preview?.findElement((element) => element.source.id === this.activeCompositionId);
            if (activeCompositionElement) {
                this.tracks = groupBy(activeCompositionElement.elements || [], (element) => element.track);
                if (this.state) {
                    this.activeParents = findPathToNode(this.state, this.activeCompositionId);
                }
            }


        } else {
            this.tracks = groupBy(this.state?.elements || [], (element) => element.track);
            if (this.state) {
                this.activeParents = null
            }
        }
    }

    getActiveElement(): ElementState | undefined {
        if (!this.preview || this.activeElementIds.length === 0) {
            return undefined;
        }

        const id = videoCreator.activeElementIds[0];
        return this.preview.findElement((element) => element.source.id === id, this.state);
    }

    async createElement(elementSource: Record<string, any>): Promise<void> {
        const preview = this.preview;
        if (!preview || !preview.state) {
            return;
        }

        const source = preview.getSource();
        const newTrack = Math.max(...preview.state.elements.map((element) => element.track)) + 1;

        const id = uuid();

        source.elements.push({
            id,
            track: newTrack,
            ...elementSource,
        });

        await preview.setSource(source, true);

        await this.setActiveElements(id);
    }

    async deleteElement(elementId: string): Promise<void> {
        const preview = this.preview;
        if (!preview || !preview.state) {
            return;
        }

        // Clone the current preview state
        const state = deepClone(preview.state);

        // Remove the element
        state.elements = state.elements.filter((element) => element.source.id !== elementId);

        // Set source by the mutated state
        await preview.setSource(preview.getSource(state), true);
    }

    async rearrangeTracks(track: number, direction: 'up' | 'down'): Promise<void> {
        const preview = this.preview;
        if (!preview || !preview.state) {
            return;
        }

        // The track number to swap with
        const targetTrack = direction === 'up' ? track + 1 : track - 1;
        if (targetTrack < 1) {
            return;
        }

        // Elements at provided track
        const elementsCurrentTrack = preview.state.elements.filter((element) => element.track === track);
        if (elementsCurrentTrack.length === 0) {
            return;
        }

        // Clone the current preview state
        const state = deepClone(preview.state);

        // Swap track numbers
        for (const element of state.elements) {
            if (element.track === track) {
                element.source.track = targetTrack;
            } else if (element.track === targetTrack) {
                element.source.track = track;
            }
        }

        // Set source by the mutated state
        await preview.setSource(preview.getSource(state), true);
    }

    async finishVideo(): Promise<any> {
        const preview = this.preview;
        if (!preview) {
            return;
        }

        const response = await fetch('/api/videos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                source: preview.getSource(),
            }),
        });

        return await response.json();
    }

    getDefaultSource() {
        // Replace this with your own JSON source

        return {
            "output_format": "mp4",
            "width": 720,
            "height": 1280,
            "duration": "35.5675 s",
            "elements": [
                {
                    "id": "097faab2-7969-4a34-afba-551a2d4cd6ba",
                    "name": "slide1",
                    "type": "composition",
                    "track": 1,
                    "time": "0.0302 s",
                    "duration": "6 s",
                    "elements": [
                        {
                            "id": "ee029b87-d45d-4894-8bbb-3e1d27a667f2",
                            "name": "video-1",
                            "type": "video",
                            "track": 1,
                            "time": "0 s",
                            "duration": "6 s",
                            "clip": true,
                            "animations": [
                                {
                                    "type": "scale",
                                    "end_scale": "150%",
                                    "fade": false,
                                    "scope": "element",
                                    "start_scale": "100%",
                                    "x_anchor": "50%",
                                    "y_anchor": "50%"
                                }
                            ],
                            "source": "https://cdn.vidiofy.ai/pipeline/assets/1689601034564/69321780-773d-4a89-85a5-c51ac4c001e9..mp4",
                            "trim_duration": "6 s",
                            "volume": "50%"
                        },
                        {
                            "id": "27c3336e-01d0-457e-9f0c-6a602e9f1226",
                            "type": "shape",
                            "track": 2,
                            "x": [
                                {
                                    "time": "0.815 s",
                                    "value": "47.6852%"
                                },
                                {
                                    "time": "1.086 s",
                                    "value": "50%"
                                }
                            ],
                            "y": [
                                {
                                    "time": "0.815 s",
                                    "value": "50.3034%"
                                },
                                {
                                    "time": "1.086 s",
                                    "value": "2.1263%"
                                }
                            ],
                            "width": [
                                {
                                    "time": "0.815 s",
                                    "value": "130.6334%"
                                },
                                {
                                    "time": "1.086 s",
                                    "value": "59.3371%"
                                }
                            ],
                            "height": [
                                {
                                    "time": "0.815 s",
                                    "value": "108.1255%"
                                },
                                {
                                    "time": "1.086 s",
                                    "value": "11.7713%"
                                }
                            ],
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "border_radius": "5 vmin",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "d0965733-f81c-4c1c-a65a-16f7a8e599fb",
                            "name": "logo",
                            "type": "image",
                            "track": 3,
                            "time": "0 s",
                            "duration": "6 s",
                            "x": [
                                {
                                    "time": "0.754 s",
                                    "value": "50%"
                                },
                                {
                                    "time": "1.146 s",
                                    "value": "50%"
                                }
                            ],
                            "y": [
                                {
                                    "time": "0.754 s",
                                    "value": "48.437%"
                                },
                                {
                                    "time": "1.146 s",
                                    "value": "4.2861%"
                                }
                            ],
                            "width": [
                                {
                                    "time": "0.754 s",
                                    "value": "57.483%"
                                },
                                {
                                    "time": "1.146 s",
                                    "value": "42.8504%"
                                }
                            ],
                            "height": [
                                {
                                    "time": "0.754 s",
                                    "value": "3.126%"
                                },
                                {
                                    "time": "1.146 s",
                                    "value": "2.3303%"
                                }
                            ],
                            "source": "f37bb151-93f8-4af2-8991-f1fd2568e960"
                        },
                        {
                            "id": "5cac18fc-2fce-4477-813c-49cce37fbc3d",
                            "type": "composition",
                            "track": 4,
                            "time": "0.845 s",
                            "duration": "5.0041 s",
                            "y": "72.3061%",
                            "width": "91.7685%",
                            "height": "26.3363%",
                            "animations": [
                                {
                                    "time": "start",
                                    "duration": "0.5 s",
                                    "easing": "quadratic-out",
                                    "type": "wipe",
                                    "end_angle": "270°",
                                    "fade": false,
                                    "start_angle": "270°",
                                    "x_anchor": "0%"
                                },
                                {
                                    "time": "end",
                                    "duration": "0.36 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "wipe",
                                    "end_angle": "270°",
                                    "fade": false,
                                    "start_angle": "270°",
                                    "x_anchor": "0%"
                                }
                            ],
                            "elements": [
                                {
                                    "id": "ede5b021-5b9a-4311-94b6-6a7cff29eb08",
                                    "type": "composition",
                                    "track": 1,
                                    "time": "0 s",
                                    "y": "50.0001%",
                                    "height": "99.9998%",
                                    "elements": [
                                        {
                                            "id": "61fb2356-1387-45b6-97f0-7ee122b97ec1",
                                            "type": "shape",
                                            "track": 1,
                                            "time": "0 s",
                                            "duration": "6 s",
                                            "width": "100%",
                                            "height": "99.9999%",
                                            "x_anchor": "50%",
                                            "y_anchor": "50%",
                                            "fill_color": "#000000",
                                            "clip": true,
                                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                                        },
                                        {
                                            "id": "c398683d-c7c8-4abf-a23c-1a8c112e1d99",
                                            "type": "shape",
                                            "track": 2,
                                            "time": "0 s",
                                            "duration": "6 s",
                                            "y": "45.9166%",
                                            "width": "100%",
                                            "height": "91.8331%",
                                            "x_anchor": "50%",
                                            "y_anchor": "50%",
                                            "fill_color": "rgba(220,58,55,1)",
                                            "clip": true,
                                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                                        },
                                        {
                                            "id": "dcb831b5-5afc-4117-af71-e9872d5c31f7",
                                            "type": "shape",
                                            "track": 3,
                                            "time": "0 s",
                                            "x": "50.3418%",
                                            "y": "41.6662%",
                                            "width": "105.5624%",
                                            "height": "83.3324%",
                                            "x_anchor": "50%",
                                            "y_anchor": "50%",
                                            "fill_color": "#ffffff",
                                            "clip": true,
                                            "animations": [
                                                {
                                                    "time": "start",
                                                    "duration": "1 s",
                                                    "easing": "quadratic-out",
                                                    "type": "scale",
                                                    "axis": "y",
                                                    "fade": false,
                                                    "y_anchor": "0%"
                                                }
                                            ],
                                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                                        },
                                        {
                                            "id": "d172955f-8c8d-49dc-9d52-d0607a2afd00",
                                            "name": "title",
                                            "type": "text",
                                            "track": 5,
                                            "time": "0 s",
                                            "x": "6.8597%",
                                            "y": "10.2026%",
                                            "width": "86.8015%",
                                            "height": "76.3718%",
                                            "x_anchor": "0%",
                                            "y_anchor": "0%",
                                            "fill_color": "#333333",
                                            "animations": [
                                                {
                                                    "time": "0.64 s",
                                                    "duration": "1 s",
                                                    "easing": "quadratic-out",
                                                    "type": "text-slide",
                                                    "direction": "up",
                                                    "scope": "split-clip",
                                                    "split": "line"
                                                }
                                            ],
                                            "text": "A foldable phone, new tablet and lots of AI: What Google unveiled at its big developer event | CNN Business",
                                            "font_family": "Asap Condensed",
                                            "font_weight": "700",
                                            "font_size": "7.5 vmin"
                                        }
                                    ]
                                },
                                {
                                    "id": "419adbaa-4c2f-4ae9-bb4f-f518e2e78ed1",
                                    "type": "shape",
                                    "track": 2,
                                    "time": "0 s",
                                    "y": "49.3466%",
                                    "width": "96.2126%",
                                    "height": "98.6933%",
                                    "x_anchor": "50%",
                                    "y_anchor": "50%",
                                    "fill_color": "#333333",
                                    "border_radius": "2.5 vmin",
                                    "mask_mode": "alpha",
                                    "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                                }
                            ]
                        }
                    ]
                },
                {
                    "id": "03cf569f-eb31-4398-a72c-475b384f2d0e",
                    "name": "slide2",
                    "type": "composition",
                    "track": 1,
                    "time": "6.0302 s",
                    "duration": "8.2456 s",
                    "elements": [
                        {
                            "id": "d2615b3f-9fd4-45fb-8362-c185402b24e9",
                            "name": "video-1",
                            "type": "video",
                            "track": 1,
                            "time": "0 s",
                            "duration": "8.25 s",
                            "source": "https://cdn.vidiofy.ai/pipeline/assets/1689601039334/430c7e7a-87a8-40e8-91dd-224020fd008d..mp4",
                            "loop": true,
                            "volume": "50%"
                        },
                        {
                            "id": "c7ac8731-48a9-42ba-88c6-226061f874a5",
                            "type": "shape",
                            "track": 2,
                            "time": "0 s",
                            "width": "100%",
                            "height": "100%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "stroke_color": "rgba(255,255,255,1)",
                            "stroke_width": "5 vmin",
                            "stroke_join": "miter",
                            "animations": [
                                {
                                    "easing": "cubic-in-out",
                                    "type": "wipe",
                                    "fade": false,
                                    "start_angle": "-90°"
                                }
                            ],
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "7a3d4877-b3c3-4a23-8f8a-6613114b4e1e",
                            "type": "shape",
                            "track": 3,
                            "time": "0 s",
                            "width": "100%",
                            "height": "100%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "stroke_color": "rgba(220,58,55,1)",
                            "stroke_width": "5 vmin",
                            "stroke_join": "miter",
                            "animations": [
                                {
                                    "easing": "cubic-in-out",
                                    "type": "wipe",
                                    "fade": false,
                                    "start_angle": "90°"
                                }
                            ],
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "2ea33ca6-086a-4b69-98c3-44fe26a47ae9",
                            "name": "bodytext-1",
                            "type": "text",
                            "track": 4,
                            "time": "0 s",
                            "duration": "4.3659 s",
                            "x": "10.4147%",
                            "y": "32.4985%",
                            "width": "79.1706%",
                            "height": "35.003%",
                            "x_anchor": "0%",
                            "y_anchor": "0%",
                            "x_alignment": "50%",
                            "y_alignment": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "0.54 s",
                                    "duration": "0.7301 s",
                                    "easing": "quadratic-out",
                                    "type": "text-slide",
                                    "background_effect": "sliding",
                                    "distance": "200%",
                                    "scope": "element",
                                    "split": "line"
                                },
                                {
                                    "time": "end",
                                    "duration": "1 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "text-slide",
                                    "background_effect": "scaling",
                                    "direction": "down",
                                    "fade": false,
                                    "scope": "split-clip",
                                    "split": "line"
                                }
                            ],
                            "text": "The $1799 Pixel Fold, claimed as the thinnest foldable, has a tablet-like display and is packed with features like long exposure, unblur, and magic eraser.",
                            "font_family": "Roboto",
                            "font_size": "6 vmin",
                            "line_height": "180%",
                            "background_color": "rgba(220,58,55,1)",
                            "background_x_padding": "10%",
                            "background_y_padding": "10%"
                        },
                        {
                            "id": "9ff57308-6c97-4df6-8e74-1ce0cc1c2cb4",
                            "name": "bodytext-2",
                            "type": "text",
                            "track": 4,
                            "time": "4.3659 s",
                            "duration": "3.8797 s",
                            "x": "10.4147%",
                            "y": "32.4985%",
                            "width": "79.1706%",
                            "height": "35.003%",
                            "x_anchor": "0%",
                            "y_anchor": "0%",
                            "x_alignment": "50%",
                            "y_alignment": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "0.54 s",
                                    "duration": "0.7301 s",
                                    "easing": "quadratic-out",
                                    "type": "text-slide",
                                    "background_effect": "sliding",
                                    "distance": "200%",
                                    "scope": "element",
                                    "split": "line"
                                },
                                {
                                    "time": "end",
                                    "duration": "1 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "text-slide",
                                    "background_effect": "scaling",
                                    "direction": "down",
                                    "fade": false,
                                    "scope": "split-clip",
                                    "split": "line"
                                }
                            ],
                            "text": "The $1799 Pixel Fold, claimed as the thinnest foldable, has a tablet-like display and is packed with features like long exposure, unblur, and magic eraser.",
                            "font_family": "Roboto",
                            "font_size": "6 vmin",
                            "line_height": "180%",
                            "background_color": "rgba(220,58,55,1)",
                            "background_x_padding": "10%",
                            "background_y_padding": "10%"
                        },
                        {
                            "id": "d7ac2354-1be9-414f-a859-3cdb1f69a349",
                            "type": "shape",
                            "track": 5,
                            "time": "0 s",
                            "y": "2.1263%",
                            "width": "59.3371%",
                            "height": "11.7713%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "border_radius": "5 vmin",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "6e80e3a3-11fe-42e4-9655-c5300e1848c3",
                            "name": "logo",
                            "type": "image",
                            "track": 6,
                            "time": "0 s",
                            "y": "4.2861%",
                            "width": "42.8504%",
                            "height": "2.3303%",
                            "source": "f37bb151-93f8-4af2-8991-f1fd2568e960"
                        }
                    ]
                },
                {
                    "id": "5e3e1704-fe31-4114-aa5a-f4679a107eb1",
                    "name": "slide3",
                    "type": "composition",
                    "track": 1,
                    "time": "14.2758 s",
                    "duration": "7.0082 s",
                    "elements": [
                        {
                            "id": "64ca5ddd-7408-47d0-b748-48db1befe530",
                            "type": "shape",
                            "track": 1,
                            "time": "0 s",
                            "width": "100%",
                            "height": "100%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "rgba(255,255,255,1)",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "58b1c584-0b67-4f78-8eab-7fc0dae19ad3",
                            "type": "shape",
                            "track": 2,
                            "time": "0 s",
                            "width": "100%",
                            "height": "100%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "rgba(220,58,55,1)",
                            "animations": [
                                {
                                    "time": "start",
                                    "duration": "0.4902 s",
                                    "easing": "quadratic-out",
                                    "type": "slide",
                                    "direction": "180°",
                                    "fade": false
                                }
                            ],
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "6ddf5872-3a49-4331-96e9-5a66428087ac",
                            "type": "shape",
                            "track": 3,
                            "time": "0 s",
                            "x": "51.746%",
                            "width": "96.5079%",
                            "height": "100%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "0.48 s",
                                    "duration": "0.5502 s",
                                    "easing": "quadratic-out",
                                    "type": "slide",
                                    "direction": "180°",
                                    "fade": false
                                }
                            ],
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "12efc8be-ce61-4bdd-8c91-4d4feb28688a",
                            "type": "composition",
                            "track": 4,
                            "time": "0 s",
                            "height": "100.0001%",
                            "animations": [
                                {
                                    "time": "0.654 s",
                                    "duration": "1 s",
                                    "easing": "quadratic-out",
                                    "type": "slide",
                                    "direction": "180°",
                                    "fade": false
                                }
                            ],
                            "elements": [
                                {
                                    "id": "8f431f57-13f2-4a7c-a4ab-ca42b3bbe5f6",
                                    "name": "video-1",
                                    "type": "video",
                                    "track": 1,
                                    "time": "0 s",
                                    "duration": "7.01 s",
                                    "animations": [
                                        {
                                            "time": "end",
                                            "duration": "5.705 s",
                                            "type": "pan",
                                            "end_x": "0%",
                                            "end_y": "50%",
                                            "scope": "element",
                                            "start_x": "100%",
                                            "start_y": "50%"
                                        }
                                    ],
                                    "source": "https://cdn.vidiofy.ai/pipeline/assets/1691127055238/7eabc029-b856-45ba-9f23-67ecd8e09667.mp4",
                                    "trim_duration": "7.01 s",
                                    "loop": true
                                },
                                {
                                    "id": "c81722de-10ef-4936-a261-b93f0b3ebfa9",
                                    "type": "shape",
                                    "track": 2,
                                    "time": "0 s",
                                    "duration": "6 s",
                                    "x": "53.7675%",
                                    "width": "92.4648%",
                                    "height": "99.9999%",
                                    "x_anchor": "50%",
                                    "y_anchor": "50%",
                                    "fill_color": "#ffffff",
                                    "mask_mode": "alpha",
                                    "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                                }
                            ]
                        },
                        {
                            "id": "bde6ea25-c87a-4ce6-96a8-0172b98a9a94",
                            "name": "bodytext-1",
                            "type": "text",
                            "track": 5,
                            "time": "0 s",
                            "duration": "3.4625 s",
                            "x": "20.5086%",
                            "y": "23.5313%",
                            "width": "61.132%",
                            "height": "52.9375%",
                            "x_anchor": "0%",
                            "y_anchor": "0%",
                            "y_alignment": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "1.164 s",
                                    "duration": "0.6701 s",
                                    "easing": "quadratic-out",
                                    "type": "text-slide",
                                    "background_effect": "sliding",
                                    "direction": "left",
                                    "distance": "200%",
                                    "scope": "element",
                                    "split": "line"
                                },
                                {
                                    "time": "end",
                                    "duration": "0.6681 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "text-slide",
                                    "background_effect": "scaling",
                                    "distance": "200%",
                                    "fade": false,
                                    "scope": "element",
                                    "split": "line"
                                }
                            ],
                            "text": "The Pixel Fold includes dual screen live translate, allowing users to communicate in another language with fast audio and text translations.",
                            "font_family": "Roboto",
                            "font_size": "6 vmin",
                            "line_height": "180%",
                            "background_color": "rgba(220,58,55,1)",
                            "background_x_padding": "10%",
                            "background_y_padding": "10%"
                        },
                        {
                            "id": "6eef3021-26fb-49b6-b015-b3e783e0e92e",
                            "name": "bodytext-2",
                            "type": "text",
                            "track": 6,
                            "time": "3.4625 s",
                            "x": "20.5086%",
                            "y": "23.5313%",
                            "width": "62.5155%",
                            "height": "52.9375%",
                            "x_anchor": "0%",
                            "y_anchor": "0%",
                            "y_alignment": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "0.177 s",
                                    "duration": "0.6701 s",
                                    "easing": "quadratic-out",
                                    "type": "text-slide",
                                    "background_effect": "sliding",
                                    "direction": "left",
                                    "distance": "200%",
                                    "scope": "element",
                                    "split": "line"
                                },
                                {
                                    "time": "end",
                                    "duration": "0.7888 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "text-slide",
                                    "background_effect": "scaling",
                                    "distance": "200%",
                                    "fade": false,
                                    "scope": "element",
                                    "split": "line"
                                }
                            ],
                            "text": "The Pixel Fold includes dual screen live translate, allowing users to communicate in another language with fast audio and text translations.",
                            "font_family": "Roboto",
                            "font_size": "6 vmin",
                            "line_height": "180%",
                            "background_color": "rgba(220,58,55,1)",
                            "background_x_padding": "10%",
                            "background_y_padding": "10%"
                        },
                        {
                            "id": "57ed8bea-244a-434e-8f82-9b8ebeca2179",
                            "type": "shape",
                            "track": 7,
                            "time": "0 s",
                            "y": "2.1263%",
                            "width": "59.3371%",
                            "height": "11.7713%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "border_radius": "5 vmin",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "4113c56d-49ec-4ca5-b951-c97d013f6f5b",
                            "name": "logo",
                            "type": "image",
                            "track": 8,
                            "time": "0 s",
                            "y": "4.2861%",
                            "width": "42.8504%",
                            "height": "2.3303%",
                            "source": "f37bb151-93f8-4af2-8991-f1fd2568e960"
                        }
                    ]
                },
                {
                    "id": "78403ba6-da80-4e91-8aa0-97fcc1f8dc31",
                    "name": "slide4",
                    "type": "composition",
                    "track": 1,
                    "time": "21.284 s",
                    "duration": "6.2835 s",
                    "elements": [
                        {
                            "id": "f91b8b1a-c339-43ed-865d-89dc5255c3f0",
                            "type": "shape",
                            "track": 1,
                            "time": "0 s",
                            "width": "100%",
                            "height": "100%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "f391e919-07d1-42ff-be00-b854f8d6adc5",
                            "name": "video-1",
                            "type": "video",
                            "track": 2,
                            "time": "0 s",
                            "duration": "6.28 s",
                            "source": "https://cdn.vidiofy.ai/pipeline/assets/1689601039334/430c7e7a-87a8-40e8-91dd-224020fd008d..mp4",
                            "volume": "50%"
                        },
                        {
                            "id": "7ad7d0d2-e196-42f5-94b5-732506f42084",
                            "name": "bodytext-1",
                            "type": "text",
                            "track": 3,
                            "time": "0 s",
                            "duration": "3.092 s",
                            "x": "10.4147%",
                            "y": "29.6808%",
                            "width": "79.1706%",
                            "height": "40.6384%",
                            "x_anchor": "0%",
                            "y_anchor": "0%",
                            "x_alignment": "50%",
                            "y_alignment": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "0.42 s",
                                    "duration": "0.7566 s",
                                    "easing": "quadratic-out",
                                    "type": "text-slide",
                                    "background_effect": "sliding",
                                    "direction": "left",
                                    "distance": "200%",
                                    "scope": "element",
                                    "split": "line"
                                },
                                {
                                    "time": "end",
                                    "duration": "0.7888 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "text-appear",
                                    "split": "line"
                                }
                            ],
                            "text": "Google's new Pixel 7a boasts a Tensor G2 processor, Titan M2 security chip, wireless charging, and advanced camera features.",
                            "font_family": "Roboto",
                            "font_size": "6 vmin",
                            "line_height": "180%",
                            "background_color": "rgba(220,58,55,1)",
                            "background_x_padding": "10%",
                            "background_y_padding": "10%"
                        },
                        {
                            "id": "8eb8eebb-1a73-4f4b-86c2-b9731fcaa3cb",
                            "name": "bodytext-2",
                            "type": "text",
                            "track": 4,
                            "time": "3.092 s",
                            "duration": "3.092 s",
                            "x": "10.4147%",
                            "y": "29.6808%",
                            "width": "79.1706%",
                            "height": "40.6384%",
                            "x_anchor": "0%",
                            "y_anchor": "0%",
                            "x_alignment": "50%",
                            "y_alignment": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "0.209 s",
                                    "duration": "0.5474 s",
                                    "easing": "quadratic-out",
                                    "type": "text-slide",
                                    "background_effect": "sliding",
                                    "direction": "left",
                                    "distance": "200%",
                                    "scope": "element",
                                    "split": "line"
                                }
                            ],
                            "text": "Google's new Pixel 7a boasts a Tensor G2 processor, Titan M2 security chip, wireless charging, and advanced camera features.",
                            "font_family": "Roboto",
                            "font_size": "6 vmin",
                            "line_height": "180%",
                            "background_color": "rgba(220,58,55,1)",
                            "background_x_padding": "10%",
                            "background_y_padding": "10%"
                        },
                        {
                            "id": "88aef534-49f3-4ad7-96e4-1b995377d9cd",
                            "type": "shape",
                            "track": 5,
                            "time": "0 s",
                            "y": "2.1263%",
                            "width": "59.3371%",
                            "height": "11.7713%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "border_radius": "5 vmin",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "30453270-e630-462b-93df-7b93c7bed56c",
                            "name": "logo",
                            "type": "image",
                            "track": 6,
                            "time": "0 s",
                            "y": "4.2861%",
                            "width": "42.8504%",
                            "height": "2.3303%",
                            "source": "f37bb151-93f8-4af2-8991-f1fd2568e960"
                        }
                    ]
                },
                {
                    "id": "8ebed691-43de-452f-835c-ed73ecc8afa4",
                    "name": "slide5",
                    "type": "composition",
                    "track": 1,
                    "time": "27.5675 s",
                    "duration": "8 s",
                    "elements": [
                        {
                            "id": "22c450de-6f29-4d7d-806d-6d5500232717",
                            "type": "shape",
                            "track": 1,
                            "time": "0 s",
                            "width": "109.7603%",
                            "height": "100.3267%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "596ce483-fc14-49e8-8cdf-ce9f32c8218f",
                            "name": "video-1",
                            "type": "video",
                            "track": 2,
                            "time": "0 s",
                            "duration": "8 s",
                            "height": "100.0001%",
                            "animations": [
                                {
                                    "time": "5.694 s",
                                    "duration": "1 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "color-wipe",
                                    "color": "#ffffff",
                                    "direction": "down"
                                }
                            ],
                            "source": "https://cdn.vidiofy.ai/pipeline/assets/1689601034564/69321780-773d-4a89-85a5-c51ac4c001e9..mp4",
                            "volume": "50%"
                        },
                        {
                            "id": "618f90ed-33e9-4b52-9009-102df2cfd5d8",
                            "name": "bodytext-1",
                            "type": "text",
                            "track": 3,
                            "time": "0 s",
                            "x": "10.4147%",
                            "y": "29.6808%",
                            "width": "79.1706%",
                            "height": "40.6384%",
                            "x_anchor": "0%",
                            "y_anchor": "0%",
                            "x_alignment": "50%",
                            "y_alignment": "50%",
                            "fill_color": "#ffffff",
                            "animations": [
                                {
                                    "time": "5.064 s",
                                    "duration": "1 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "text-appear",
                                    "split": "line"
                                }
                            ],
                            "text": "Google introduced the Pixel Tablet for home use, featuring Tensor G2 chips, long battery life, AI features, and a charging dock.",
                            "font_family": "Roboto",
                            "font_size": "6 vmin",
                            "line_height": "180%",
                            "background_color": "rgba(220,58,55,1)",
                            "background_x_padding": "10%",
                            "background_y_padding": "10%"
                        },
                        {
                            "id": "bd58a20b-9e7a-446d-99de-ae830454fdca",
                            "type": "shape",
                            "track": 4,
                            "time": "0 s",
                            "y": "2.1263%",
                            "width": "59.3371%",
                            "height": "11.7713%",
                            "x_anchor": "50%",
                            "y_anchor": "50%",
                            "fill_color": "#ffffff",
                            "border_radius": "5 vmin",
                            "path": "M 0 0 L 100 0 L 100 100 L 0 100 L 0 0 Z"
                        },
                        {
                            "id": "e6bee3c9-0f21-4793-8d0e-11f3f65fae50",
                            "name": "logo",
                            "type": "image",
                            "track": 5,
                            "time": "0 s",
                            "x": [
                                {
                                    "time": "6.837 s",
                                    "value": "50%"
                                },
                                {
                                    "time": "7.38 s",
                                    "value": "50%"
                                }
                            ],
                            "y": [
                                {
                                    "time": "6.837 s",
                                    "value": "4.2861%"
                                },
                                {
                                    "time": "7.38 s",
                                    "value": "50%"
                                }
                            ],
                            "width": [
                                {
                                    "time": "6.837 s",
                                    "value": "42.8504%"
                                },
                                {
                                    "time": "7.38 s",
                                    "value": "66.6608%"
                                }
                            ],
                            "height": [
                                {
                                    "time": "6.837 s",
                                    "value": "2.3303%"
                                },
                                {
                                    "time": "7.38 s",
                                    "value": "3.6252%"
                                }
                            ],
                            "animations": [
                                {
                                    "time": "7.573 s",
                                    "duration": "0.2156 s",
                                    "easing": "quadratic-out",
                                    "reversed": true,
                                    "type": "scale",
                                    "x_anchor": "50%",
                                    "y_anchor": "50%"
                                }
                            ],
                            "source": "f37bb151-93f8-4af2-8991-f1fd2568e960"
                        }
                    ]
                },
                {
                    "id": "e0887519-f31a-4b6b-84d6-04f82a4137a0",
                    "type": "audio",
                    "track": 2,
                    "duration": null,
                    "source": "11388dfb-8455-48fd-9776-b1758b7844b9",
                    "trim_duration": "35.57 s",
                    "audio_fade_in": "0 s",
                    "audio_fade_out": "3 s"
                }
            ]
        };
    }
}

export const videoCreator = new VideoCreatorStore();
