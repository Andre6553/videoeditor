import React, { useMemo } from 'react';
import { ColorGrading } from '../types';

interface ColorGradeFilterProps {
    id: string;
    grading: ColorGrading | undefined;
}

export const ColorGradeFilter: React.FC<ColorGradeFilterProps> = ({ id, grading }) => {
    const matrix = useMemo(() => {
        if (!grading) return null;

        // Default values
        const brightness = typeof grading.brightness === 'number' ? grading.brightness : 1;
        const contrast = typeof grading.contrast === 'number' ? grading.contrast : 1;
        const saturation = typeof grading.saturation === 'number' ? grading.saturation : 1;
        const exposure = typeof grading.exposure === 'number' ? grading.exposure : 0;

        // 1. Saturation Matrix
        // Standard luminance weights for RGB
        const lumR = 0.3086;
        const lumG = 0.6094;
        const lumB = 0.0820;

        const s = saturation;
        const sr = (1 - s) * lumR;
        const sg = (1 - s) * lumG;
        const sb = (1 - s) * lumB;

        // Saturation matrix
        // [ sr+s  sg    sb    0  0 ]
        // [ sr    sg+s  sb    0  0 ]
        // [ sr    sg    sb+s  0  0 ]
        // [ 0     0     0     1  0 ]

        // 2. Brightness & Exposure (Gain)
        // Combined multiplier
        const exposureMultiplier = Math.pow(2, exposure);
        const gain = brightness * exposureMultiplier;

        // 3. Contrast (Shadow Lift/Crush)
        // The user specifically liked the "Shadow Adjustment" logic where contrast affects the offset.
        // Standard contrast usually pivots around 0.5, but here we implement the requested behavior:
        // Lower contrast = lift shadows (add offset)
        // Higher contrast = crush shadows (subtract offset)
        // We'll stick to the logic that worked: offset += (1 - contrast) * 0.5
        const shadowLift = (1 - contrast) * 0.5;

        // Combine Saturation + Gain + Lift
        // Result = (SatMatrix * Input) * Gain + Lift

        // R row
        const r1 = (sr + s) * gain;
        const r2 = sg * gain;
        const r3 = sb * gain;
        const r4 = 0;
        const r5 = shadowLift;

        // G row
        const g1 = sr * gain;
        const g2 = (sg + s) * gain;
        const g3 = sb * gain;
        const g4 = 0;
        const g5 = shadowLift;

        // B row
        const b1 = sr * gain;
        const b2 = sg * gain;
        const b3 = (sb + s) * gain;
        const b4 = 0;
        const b5 = shadowLift;

        // Alpha row (identity)
        const a1 = 0;
        const a2 = 0;
        const a3 = 0;
        const a4 = 1;
        const a5 = 0;

        return [
            r1, r2, r3, r4, r5,
            g1, g2, g3, g4, g5,
            b1, b2, b3, b4, b5,
            a1, a2, a3, a4, a5
        ].join(' ');
    }, [grading]);

    const sharpenKernel = useMemo(() => {
        if (!grading || !grading.sharpness) return null;

        const amount = grading.sharpness; // 0 to 1
        if (amount <= 0) return null;

        // Simple 3x3 Sharpen Kernel
        // [  0  -k   0 ]
        // [ -k 1+4k -k ]
        // [  0  -k   0 ]

        // Map 0-1 slider to a reasonable kernel strength (e.g., 0 to 2)
        const k = amount * 2;

        const center = 1 + 4 * k;
        const side = -k;

        return `
      0 ${side} 0
      ${side} ${center} ${side}
      0 ${side} 0
    `;
    }, [grading]);

    if (!grading) return null;

    return (
        <svg className="absolute w-0 h-0 pointer-events-none" style={{ display: 'none' }}>
            <defs>
                <filter id={id} colorInterpolationFilters="sRGB">
                    {/* 1. Color Grading (Exposure, Contrast, Saturation, Brightness) */}
                    <feColorMatrix
                        type="matrix"
                        values={matrix || "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"}
                        result="graded"
                    />

                    {/* 2. Sharpness (Convolution) */}
                    {sharpenKernel ? (
                        <feConvolveMatrix
                            order="3,3"
                            kernelMatrix={sharpenKernel}
                            preserveAlpha="true"
                            in="graded"
                            result="sharpened"
                        />
                    ) : null}
                </filter>
            </defs>
        </svg>
    );
};
