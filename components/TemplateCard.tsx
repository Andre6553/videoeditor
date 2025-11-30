import React from 'react';
import type { Template } from '../types';

interface TemplateCardProps {
  template: Template;
  isActive: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
}

const TemplateLayoutPreview: React.FC<{ layout: Template['layout'] }> = ({ layout }) => (
  <div className="w-full h-12 bg-gray-900 rounded-md flex p-1 gap-1 mb-2 pointer-events-none">
    {layout === 'solo' && <div className="w-full h-full bg-gray-600 rounded-sm" />}
    {layout === 'duet-vertical' && (
      <>
        <div className="w-1/2 h-full bg-gray-600 rounded-sm" />
        <div className="w-1/2 h-full bg-gray-600 rounded-sm" />
      </>
    )}
    {layout === 'duet-horizontal' && (
      <div className="w-full h-full flex flex-col gap-1">
        <div className="w-full h-1/2 bg-gray-600 rounded-sm" />
        <div className="w-full h-1/2 bg-gray-600 rounded-sm" />
      </div>
    )}
    {layout === 'trio-stack' && (
      <div className="w-full h-full flex flex-col gap-1">
        <div className="w-full h-1/3 bg-gray-600 rounded-sm" />
        <div className="w-full h-1/3 bg-gray-600 rounded-sm" />
        <div className="w-full h-1/3 bg-gray-600 rounded-sm" />
      </div>
    )}
  </div>
);


export const TemplateCard: React.FC<TemplateCardProps> = ({ template, isActive, onClick, onDragStart }) => {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg transition-all duration-200 border-2 cursor-grab active:cursor-grabbing ${isActive
        ? 'bg-orange-500/20 border-orange-500 shadow-lg'
        : 'bg-gray-700/50 border-transparent hover:border-orange-500/50 hover:bg-gray-700'
        }`}
    >
      <TemplateLayoutPreview layout={template.layout} />
      <h3 className={`font-semibold ${isActive ? 'text-white' : 'text-gray-200'}`}>{template.name}</h3>
      <p className={`text-xs ${isActive ? 'text-orange-200' : 'text-gray-400'}`}>{template.description}</p>
    </div>
  );
};
