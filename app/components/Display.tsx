

interface DisplayProps {
    content: string[];
}

export default function Display({ content }: DisplayProps) {
    if (!content || content.length === 0) {
        return <div>No content available</div>;
    }

    return (
        <div className="space-y-6">
            {content.map((chunk, idx) => (
                <div
                    key={idx}
                    className="bg-white p-4 rounded-xl shadow-md border border-slate-300"
                >
                    <h2 className="text-lg font-semibold mb-2 text-slate-600">Chunk {idx + 1}</h2>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{chunk}</p>
                </div>
            ))}
        </div>
    );
}
