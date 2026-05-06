function PageHeader({ title, description, buttonText }) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-3xl font-black text-gray-900">{title}</h1>
        <p className="text-gray-500 mt-1">{description}</p>
      </div>

      {buttonText && (
        <button className="bg-[#b33100] text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-[#8f2800]">
          {buttonText}
        </button>
      )}
    </div>
  );
}

export default PageHeader;