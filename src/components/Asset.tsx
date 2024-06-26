import { Accessor } from "solid-js";

import { Side } from "../consts/Enums";
import { useCreateContext } from "../context/Create";
import "../style/asset.scss";

const Asset = ({ side, signal }: { side: Side; signal: Accessor<string> }) => {
    const openSelect = () => {
        setAssetSelected(side);
        setAssetSelect(true);
    };

    const { setAssetSelected, setAssetSelect } = useCreateContext();

    return (
        <div class="asset-wrap" onClick={openSelect}>
            <div class={`asset asset-${signal()}`}>
                <div class="asset-selection">
                    <span class="icon"></span>
                    <span class="asset-text"></span>
                    <span class="arrow-down"></span>
                </div>
            </div>
            <div class="assets-select"></div>
        </div>
    );
};

export default Asset;
