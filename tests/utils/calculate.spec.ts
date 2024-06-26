import { BigNumber } from "bignumber.js";

import { SwapType } from "../../src/consts/Enums";
import {
    calculateBoltzFeeOnSend,
    calculateReceiveAmount,
    calculateSendAmount,
} from "../../src/utils/calculate";

describe("Calculate amounts", () => {
    const swapFees = {
        swapType: SwapType.Submarine,
        minerFee: 147,
        boltzFee: 0.1,
    };

    const reverseSwapFees = {
        swapType: SwapType.Reverse,
        minerFee: 428,
        boltzFee: 0.25,
    };

    describe("should calculate Swap amounts", () => {
        test.each`
            sendAmount            | receiveAmount
            ${BigNumber(10157)}   | ${BigNumber(10000)}
            ${BigNumber(12473)}   | ${BigNumber(12313)}
            ${BigNumber(4299409)} | ${BigNumber(4294967)}
            ${BigNumber(62531)}   | ${BigNumber(62321)}
        `(
            "calculate amounts $sendAmount <-> $receiveAmount",
            ({ sendAmount, receiveAmount }) => {
                expect(
                    calculateReceiveAmount(
                        sendAmount,
                        swapFees.boltzFee,
                        swapFees.minerFee,
                        swapFees.swapType,
                    ),
                ).toEqual(receiveAmount);
                expect(
                    calculateSendAmount(
                        receiveAmount,
                        swapFees.boltzFee,
                        swapFees.minerFee,
                        swapFees.swapType,
                    ),
                ).toEqual(sendAmount);
            },
        );

        test("should not return negative numbers", () => {
            expect(
                calculateReceiveAmount(
                    BigNumber(0),
                    swapFees.boltzFee,
                    swapFees.minerFee,
                    swapFees.swapType,
                ),
            ).toEqual(BigNumber(0));
        });
    });

    describe("should calculate Reverse Swap amounts", () => {
        test.each`
            sendAmount            | receiveAmount
            ${BigNumber(1000000)} | ${BigNumber(997072)}
            ${BigNumber(10000)}   | ${BigNumber(9547)}
            ${BigNumber(122344)}  | ${BigNumber(121610)}
            ${BigNumber(4294967)} | ${BigNumber(4283801)}
        `(
            "calculate amounts $sendAmount <-> $receiveAmount",
            ({ sendAmount, receiveAmount }) => {
                expect(
                    calculateReceiveAmount(
                        sendAmount,
                        reverseSwapFees.boltzFee,
                        reverseSwapFees.minerFee,
                        reverseSwapFees.swapType,
                    ),
                ).toEqual(receiveAmount);
                expect(
                    calculateSendAmount(
                        receiveAmount,
                        reverseSwapFees.boltzFee,
                        reverseSwapFees.minerFee,
                        reverseSwapFees.swapType,
                    ),
                ).toEqual(sendAmount);
            },
        );

        test("should not return negative numbers", () => {
            expect(
                calculateReceiveAmount(
                    BigNumber(0),
                    reverseSwapFees.boltzFee,
                    reverseSwapFees.minerFee,
                    reverseSwapFees.swapType,
                ),
            ).toEqual(BigNumber(0));
        });
    });

    describe("should calculate Boltz fee based on send amount", () => {
        test.each`
            sendAmount            | receiveAmount         | fee
            ${BigNumber(10157)}   | ${BigNumber(10000)}   | ${BigNumber(10)}
            ${BigNumber(12473)}   | ${BigNumber(12313)}   | ${BigNumber(13)}
            ${BigNumber(4299409)} | ${BigNumber(4294967)} | ${BigNumber(4295)}
            ${BigNumber(62531)}   | ${BigNumber(62321)}   | ${BigNumber(63)}
            ${BigNumber(100)}     | ${BigNumber(-47)}     | ${BigNumber(0)}
        `(
            "should calculate fee for Swaps $sendAmount -> $fee",
            ({ sendAmount, receiveAmount, fee }) => {
                expect(
                    calculateBoltzFeeOnSend(
                        sendAmount,
                        swapFees.boltzFee,
                        swapFees.minerFee,
                        swapFees.swapType,
                    ),
                ).toEqual(fee);
                expect(
                    sendAmount
                        .minus(
                            calculateBoltzFeeOnSend(
                                sendAmount,
                                swapFees.boltzFee,
                                swapFees.minerFee,
                                swapFees.swapType,
                            ),
                        )
                        .minus(swapFees.minerFee),
                ).toEqual(receiveAmount);
            },
        );

        test.each`
            sendAmount            | receiveAmount         | fee
            ${BigNumber(1000000)} | ${BigNumber(997072)}  | ${BigNumber(2500)}
            ${BigNumber(10000)}   | ${BigNumber(9547)}    | ${BigNumber(25)}
            ${BigNumber(122344)}  | ${BigNumber(121610)}  | ${BigNumber(306)}
            ${BigNumber(4294967)} | ${BigNumber(4283801)} | ${BigNumber(10738)}
        `(
            "should calculate fee for Reverse Swaps $sendAmount -> $fee",
            ({ sendAmount, receiveAmount, fee }) => {
                expect(
                    calculateBoltzFeeOnSend(
                        sendAmount,
                        reverseSwapFees.boltzFee,
                        reverseSwapFees.minerFee,
                        reverseSwapFees.swapType,
                    ),
                ).toEqual(fee);
                expect(
                    sendAmount
                        .minus(
                            calculateBoltzFeeOnSend(
                                sendAmount,
                                reverseSwapFees.boltzFee,
                                reverseSwapFees.minerFee,
                                reverseSwapFees.swapType,
                            ),
                        )
                        .minus(reverseSwapFees.minerFee),
                ).toEqual(receiveAmount);
            },
        );

        test.each`
            reverse
            ${false}
            ${true}
        `(
            "should coalesce Boltz fee to 0 when sendAmount is NaN",
            ({ reverse }) => {
                expect(
                    calculateBoltzFeeOnSend(BigNumber(NaN), 0.1, 123, reverse),
                ).toEqual(BigNumber(0));
            },
        );

        test("should calculate negative fees", () => {
            expect(
                calculateBoltzFeeOnSend(
                    BigNumber(1_000_000),
                    -0.1,
                    swapFees.minerFee,
                    swapFees.swapType,
                ),
            ).toEqual(BigNumber(-1000));
        });
    });
});
